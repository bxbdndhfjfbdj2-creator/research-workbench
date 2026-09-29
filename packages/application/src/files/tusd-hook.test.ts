import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";
import {
  createFileUploadIntent,
} from "./upload-intent";

describe("tusd hook ingestion", () => {
  let testDb: TestDatabase;
  let hooks: typeof import("./tusd-hook");
  const signingSecret = "phase4a-tusd-hook-secret";
  const policy = {
    quarantineBucket: "rw-quarantine",
    quarantinePrefix: "uploads/",
    maxFileBytes: 1_000,
  };

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('tus-team', 'Tus Team')");
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('tus-lead', 'tus-team', 'lead@tus.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('tus-portfolio', 'tus-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('tus-project', 'tus-portfolio', 'Project', 'tus-lead')",
    );
    const modulePath = "./tusd-hook";
    hooks = await import(modulePath);
  }, 120_000);

  beforeEach(async () => {
    await testDb.client.sql.unsafe("delete from outbox_events");
    await testDb.client.sql.unsafe("delete from integration_inbox");
    await testDb.client.sql.unsafe("delete from file_upload_intents");
  });

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createIntent(byteSize = 100) {
    return createFileUploadIntent(
      testDb.client.sql,
      "tus-project",
      {
        title: "Upload target",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "paper.pdf",
        byteSize,
        declaredMediaType: "application/pdf",
      },
      { type: "human", id: "tus-lead" },
      signingSecret,
      900,
      policy.maxFileBytes,
    );
  }

  function hook(
    type: "pre-create" | "post-finish",
    uploadIntentId: string,
    options: {
      uploadId?: string | null;
      size?: number;
      offset?: number;
      metadata?: Record<string, string>;
      bucket?: string;
      key?: string;
      storageType?: string;
    } = {},
  ) {
    const size = options.size ?? 100;
    return {
      type,
      upload: {
        id: options.uploadId ?? (type === "pre-create" ? null : "tus-upload-1"),
        size,
        offset: options.offset ?? (type === "post-finish" ? size : 0),
        metadata: options.metadata ?? { workbenchUploadId: uploadIntentId },
        ...(type === "post-finish"
          ? {
              storage: {
                type: options.storageType ?? "s3store",
                bucket: options.bucket ?? policy.quarantineBucket,
                key: options.key ?? `${policy.quarantinePrefix}opaque-upload-key`,
              },
            }
          : {}),
      },
    } as const;
  }

  it("accepts a valid pre-create before tusd has assigned an upload id or storage location", async () => {
    const intent = await createIntent();

    const result = await hooks.handleTusHook(
      testDb.client.sql,
      hook("pre-create", intent.uploadIntentId),
      intent.uploadToken,
      policy,
      signingSecret,
    );

    expect(result.accepted).toBe(true);
    const rows = await testDb.client.sql.unsafe(
      "select state, tus_upload_id, quarantine_key from file_upload_intents where id = $1",
      [intent.uploadIntentId],
    );
    expect(rows[0]).toMatchObject({
      state: "uploading",
      tus_upload_id: null,
      quarantine_key: null,
    });
  });

  it("rejects unknown or stale intents, size mismatches and unsupported metadata on pre-create", async () => {
    const intent = await createIntent();

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("pre-create", "unknown-intent"),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/intent|token/i);

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("pre-create", intent.uploadIntentId, { size: 99 }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/size/i);

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("pre-create", intent.uploadIntentId, {
          metadata: { workbenchUploadId: intent.uploadIntentId, filename: "paper.pdf" },
        }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/metadata/i);

    await testDb.client.sql.unsafe(
      "update file_upload_intents set expires_at = now() - interval '1 minute' where id = $1",
      [intent.uploadIntentId],
    );
    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("pre-create", intent.uploadIntentId),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/expired|stale/i);
  });

  it("rejects incomplete or forged post-finish storage facts", async () => {
    const intent = await createIntent();
    await hooks.handleTusHook(
      testDb.client.sql,
      hook("pre-create", intent.uploadIntentId),
      intent.uploadToken,
      policy,
      signingSecret,
    );

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("post-finish", intent.uploadIntentId, { offset: 99 }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/incomplete|offset/i);

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("post-finish", intent.uploadIntentId, { bucket: "other-bucket" }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/bucket/i);

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("post-finish", intent.uploadIntentId, { key: "escape/outside" }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/prefix|key/i);

    await expect(
      hooks.handleTusHook(
        testDb.client.sql,
        hook("post-finish", intent.uploadIntentId, { size: 101, offset: 101 }),
        intent.uploadToken,
        policy,
        signingSecret,
      ),
    ).rejects.toThrow(/size/i);
  });

  it("records one sanitized inbox fact and one outbox event for duplicate post-finish hooks", async () => {
    const intent = await createIntent();
    const preCreate = hook("pre-create", intent.uploadIntentId);
    const postFinish = hook("post-finish", intent.uploadIntentId);

    await hooks.handleTusHook(
      testDb.client.sql,
      preCreate,
      intent.uploadToken,
      policy,
      signingSecret,
    );
    const first = await hooks.handleTusHook(
      testDb.client.sql,
      postFinish,
      intent.uploadToken,
      policy,
      signingSecret,
    );
    const second = await hooks.handleTusHook(
      testDb.client.sql,
      postFinish,
      intent.uploadToken,
      policy,
      signingSecret,
    );

    expect(first.accepted).toBe(true);
    expect(first.inboxId).toBeTruthy();
    expect(second).toEqual({ accepted: false, inboxId: first.inboxId });

    const intentRows = await testDb.client.sql.unsafe(
      "select state, tus_upload_id, quarantine_bucket, quarantine_key from file_upload_intents where id = $1",
      [intent.uploadIntentId],
    );
    expect(intentRows[0]).toMatchObject({
      state: "uploaded_quarantine",
      tus_upload_id: "tus-upload-1",
      quarantine_bucket: policy.quarantineBucket,
      quarantine_key: `${policy.quarantinePrefix}opaque-upload-key`,
    });

    const inboxRows = await testDb.client.sql.unsafe(
      "select external_id, payload::text as payload from integration_inbox where provider = 'tusd'",
    );
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.external_id).toBe("tus-upload-1:post-finish");
    expect(String(inboxRows[0]?.payload)).not.toContain(intent.uploadToken);
    expect(String(inboxRows[0]?.payload)).not.toContain("X-Workbench-Upload-Token");

    const outboxRows = await testDb.client.sql.unsafe(
      "select event_type, payload from outbox_events where event_type = 'file.upload.completed'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.payload).toMatchObject({
      uploadIntentId: intent.uploadIntentId,
      tusUploadId: "tus-upload-1",
    });
    expect(JSON.stringify(outboxRows[0]?.payload)).not.toContain(intent.uploadToken);
  });
});
