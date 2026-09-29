import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { appendResearchEvent } from "../events/append-research-event";
import { runInTransaction } from "../transactions";
import { verifyFileUploadToken } from "./upload-intent";

export type NormalizedTusHook = {
  type: "pre-create" | "post-finish";
  upload: {
    id: string | null;
    size: number;
    offset: number;
    metadata: Record<string, string>;
    storage?: {
      type: string;
      bucket: string;
      key: string;
    };
  };
};

export type TusHookPolicy = {
  quarantineBucket: string;
  quarantinePrefix: string;
  maxFileBytes: number;
};

type UploadIntentRow = {
  id: string;
  project_id: string;
  expected_byte_size: number | string;
  state: string;
  tus_upload_id: string | null;
  created_by: string;
  expires_at: Date | string;
};

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function validateHookShape(hook: NormalizedTusHook): void {
  if (hook.type === "pre-create") {
    if (hook.upload.id !== null) {
      throw new Error("Tus pre-create upload id must be null");
    }
    if (hook.upload.storage !== undefined) {
      throw new Error("Tus pre-create storage must be unavailable");
    }
  } else if (hook.type === "post-finish") {
    if (hook.upload.id === null) {
      throw new Error("Tus post-finish upload id is required");
    }
    requireNonEmpty(tusUploadId, "Tus upload id");
  } else {
    throw new Error("Unsupported tus hook type");
  }

  if (!Number.isSafeInteger(hook.upload.size) || hook.upload.size <= 0) {
    throw new Error("Tus upload size must be a positive safe integer");
  }
  if (!Number.isSafeInteger(hook.upload.offset) || hook.upload.offset < 0) {
    throw new Error("Tus upload offset must be a non-negative safe integer");
  }

  const metadataKeys = Object.keys(hook.upload.metadata);
  if (
    metadataKeys.length !== 1 ||
    metadataKeys[0] !== "workbenchUploadId" ||
    !hook.upload.metadata.workbenchUploadId?.trim()
  ) {
    throw new Error("Unsupported tus upload metadata");
  }
}

function validatePolicy(policy: TusHookPolicy): void {
  requireNonEmpty(policy.quarantineBucket, "Quarantine bucket");
  requireNonEmpty(policy.quarantinePrefix, "Quarantine prefix");
  if (!Number.isSafeInteger(policy.maxFileBytes) || policy.maxFileBytes <= 0) {
    throw new Error("Maximum upload size must be a positive safe integer");
  }
}

async function loadIntent(
  sql: Pick<DatabaseSql, "unsafe">,
  uploadIntentId: string,
): Promise<UploadIntentRow> {
  const rows = (await sql.unsafe(
    `select id, project_id, expected_byte_size, state, tus_upload_id, created_by, expires_at
     from file_upload_intents
     where id = $1
     limit 1`,
    [uploadIntentId],
  )) as readonly UploadIntentRow[];
  const row = rows[0];
  if (!row) throw new Error("Upload intent not found");
  return row;
}

function assertIntentMatches(
  intent: UploadIntentRow,
  hook: NormalizedTusHook,
  claims: ReturnType<typeof verifyFileUploadToken>,
  policy: TusHookPolicy,
): void {
  const metadataIntentId = hook.upload.metadata.workbenchUploadId;
  if (
    claims.uploadIntentId !== metadataIntentId ||
    claims.uploadIntentId !== intent.id
  ) {
    throw new Error("Upload token does not match upload intent");
  }
  if (claims.actorId !== intent.created_by) {
    throw new Error("Upload token actor does not match upload intent");
  }
  const expectedSize = Number(intent.expected_byte_size);
  if (
    hook.upload.size !== expectedSize ||
    claims.expectedByteSize !== expectedSize
  ) {
    throw new Error("Tus upload size does not match upload intent");
  }
  if (hook.upload.size > policy.maxFileBytes) {
    throw new Error("Tus upload size exceeds configured maximum");
  }
  if (new Date(intent.expires_at).getTime() <= Date.now()) {
    throw new Error("Upload intent expired or stale");
  }
}

function assertPostFinishStorage(
  hook: NormalizedTusHook,
  policy: TusHookPolicy,
): void {
  if (hook.upload.offset !== hook.upload.size) {
    throw new Error("Tus upload is incomplete: offset does not equal size");
  }
  const storage = hook.upload.storage;
  if (!storage) {
    throw new Error("Tus post-finish storage facts are required");
  }
  if (storage.type !== "s3store") {
    throw new Error("Unsupported tus storage type");
  }
  if (storage.bucket !== policy.quarantineBucket) {
    throw new Error("Tus upload storage bucket does not match quarantine bucket");
  }
  const key = storage.key;
  if (
    !key.startsWith(policy.quarantinePrefix) ||
    key.length <= policy.quarantinePrefix.length ||
    key.split("/").includes("..")
  ) {
    throw new Error("Tus upload storage key escapes quarantine prefix");
  }
}

function sanitizedInboxPayload(hook: NormalizedTusHook): JsonValue {
  return {
    type: hook.type,
    upload: {
      id: tusUploadId,
      size: hook.upload.size,
      offset: hook.upload.offset,
      metadata: {
        workbenchUploadId: hook.upload.metadata.workbenchUploadId,
      },
      storage: {
        type: storage.type,
        bucket: storage.bucket,
        key: storage.key,
      },
    },
  };
}

export async function handleTusHook(
  sql: DatabaseSql,
  hook: NormalizedTusHook,
  uploadToken: string,
  policy: TusHookPolicy,
  signingSecret: string,
): Promise<{ accepted: boolean; inboxId?: string }> {
  validatePolicy(policy);
  validateHookShape(hook);
  const claims = verifyFileUploadToken(uploadToken, signingSecret);
  const uploadIntentId = hook.upload.metadata.workbenchUploadId;
  const intent = await loadIntent(sql, uploadIntentId);
  assertIntentMatches(intent, hook, claims, policy);

  if (hook.type === "pre-create") {
    if (!["initiated", "uploading"].includes(intent.state)) {
      throw new Error("Upload intent is not available for pre-create");
    }
    await sql.unsafe(
      `update file_upload_intents
       set state = 'uploading',
           updated_at = now()
       where id = $1`,
      [uploadIntentId],
    );
    return { accepted: true };
  }

  if (hook.type !== "post-finish") {
    throw new Error("Unsupported tus hook type");
  }

  assertPostFinishStorage(hook, policy);
  if (!["uploading", "uploaded_quarantine"].includes(intent.state)) {
    throw new Error("Upload intent is not available for post-finish");
  }
  const tusUploadId = hook.upload.id;
  if (!tusUploadId) {
    throw new Error("Tus post-finish upload id is required");
  }
  if (intent.tus_upload_id && intent.tus_upload_id !== tusUploadId) {
    throw new Error("Tus upload id does not match upload intent");
  }

  const storage = hook.upload.storage;
  if (!storage) {
    throw new Error("Tus post-finish storage facts are required");
  }

  return runInTransaction(sql, async (tx) => {
    const proposedInboxId = randomUUID();
    const inserted = await tx.unsafe(
      `insert into integration_inbox (id, provider, external_id, payload)
       values ($1, 'tusd', $2, $3::jsonb)
       on conflict (provider, external_id) do nothing
       returning id`,
      [
        proposedInboxId,
        `${tusUploadId}:post-finish`,
        JSON.stringify(sanitizedInboxPayload(hook)),
      ],
    );

    if (!inserted[0]) {
      const existing = await tx.unsafe(
        `select id
         from integration_inbox
         where provider = 'tusd' and external_id = $1
         limit 1`,
        [`${tusUploadId}:post-finish`],
      );
      const existingId = existing[0]?.id;
      if (!existingId) {
        throw new Error("Tus inbox idempotency lookup failed after conflict");
      }
      return { accepted: false, inboxId: String(existingId) };
    }

    await tx.unsafe(
      `update file_upload_intents
       set state = 'uploaded_quarantine',
           tus_upload_id = $2,
           quarantine_bucket = $3,
           quarantine_key = $4,
           updated_at = now()
       where id = $1`,
      [
        uploadIntentId,
        tusUploadId,
        storage.bucket,
        storage.key,
      ],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: intent.project_id,
      eventType: "FILE_UPLOAD_COMPLETED",
      actor: { type: "human", id: intent.created_by },
      payload: {
        uploadIntentId,
        tusUploadId: tusUploadId,
      },
    });

    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "file.upload.completed",
      payload: {
        uploadIntentId,
        tusUploadId: tusUploadId,
      },
    });

    return { accepted: true, inboxId: proposedInboxId };
  });
}
