import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import {
  assertFileAccessClass,
  assertFileKind,
  type FileAccessClass,
  type FileKind,
} from "@research-workbench/domain/src/research-file";
import { authorizeProjectAccess } from "../auth/authorize";

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

export type FileUploadTokenClaims = {
  uploadIntentId: string;
  actorId: string;
  expectedByteSize: number;
  expiresAt: number;
};

type EncodedClaims = {
  v: 1;
  uploadIntentId: string;
  actorId: string;
  expectedByteSize: number;
  expiresAt: number;
};

function requireText(value: string | undefined | null, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function requireSigningSecret(secret: string): string {
  if (!secret.trim()) throw new Error("Upload signing secret is required");
  return secret;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", requireSigningSecret(secret))
    .update(payload)
    .digest("base64url");
}

function encodeToken(claims: EncodedClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyFileUploadToken(
  token: string,
  signingSecret: string,
  nowMs = Date.now(),
): FileUploadTokenClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new Error("Invalid upload token");
  }

  const expected = signPayload(payload, signingSecret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new Error("Invalid upload token signature");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid upload token payload");
  }

  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Invalid upload token payload");
  }
  const claims = decoded as Partial<EncodedClaims>;
  if (
    claims.v !== 1 ||
    typeof claims.uploadIntentId !== "string" ||
    !claims.uploadIntentId ||
    typeof claims.actorId !== "string" ||
    !claims.actorId ||
    !Number.isSafeInteger(claims.expectedByteSize) ||
    (claims.expectedByteSize ?? 0) <= 0 ||
    !Number.isSafeInteger(claims.expiresAt)
  ) {
    throw new Error("Invalid upload token claims");
  }
  if ((claims.expiresAt as number) <= nowMs) {
    throw new Error("Upload token expired");
  }

  return {
    uploadIntentId: claims.uploadIntentId,
    actorId: claims.actorId,
    expectedByteSize: claims.expectedByteSize as number,
    expiresAt: claims.expiresAt as number,
  };
}

export async function createFileUploadIntent(
  sql: DatabaseSql,
  projectId: string,
  input: {
    researchFileId?: string;
    title?: string;
    fileKind: FileKind;
    accessClass: FileAccessClass;
    originalFilename: string;
    byteSize: number;
    declaredMediaType?: string | null;
    changeSummary?: string | null;
  },
  actor: ActorRef,
  signingSecret: string,
  ttlSeconds: number,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<{ uploadIntentId: string; uploadToken: string; expiresAt: Date }> {
  assertHumanActor(actor);
  assertFileKind(input.fileKind);
  assertFileAccessClass(input.accessClass);
  requireSigningSecret(signingSecret);
  await authorizeProjectAccess(sql, actor.id, projectId, "file_write");

  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new Error("Upload size must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error("Maximum upload size must be a positive safe integer");
  }
  if (input.byteSize > maxFileBytes) {
    throw new Error("Upload size exceeds the configured maximum");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    throw new Error("Upload intent TTL must be between 1 and 86400 seconds");
  }

  const originalFilename = requireText(input.originalFilename, "Original filename");
  let researchFileId: string | null = null;
  let proposedTitle: string | null = null;

  if (input.researchFileId) {
    const rows = await sql.unsafe(
      `select id, project_id, file_kind, access_class
       from research_files
       where id = $1
       limit 1`,
      [input.researchFileId],
    );
    const existing = rows[0];
    if (!existing) throw new Error("Research file not found");
    if (String(existing.project_id) !== projectId) {
      throw new Error("Research file belongs to a different project");
    }
    if (
      String(existing.file_kind) !== input.fileKind ||
      String(existing.access_class) !== input.accessClass
    ) {
      throw new Error("New version must preserve the logical file kind and access class");
    }
    requireText(input.changeSummary, "Change summary");
    researchFileId = input.researchFileId;
  } else {
    proposedTitle = requireText(input.title, "Research file title");
  }

  const uploadIntentId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await sql.unsafe(
    `insert into file_upload_intents
      (id, project_id, research_file_id, proposed_title, file_kind, access_class,
       original_filename, expected_byte_size, declared_media_type, change_summary,
       state, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'initiated', $11, $12)`,
    [
      uploadIntentId,
      projectId,
      researchFileId,
      proposedTitle,
      input.fileKind,
      input.accessClass,
      originalFilename,
      input.byteSize,
      input.declaredMediaType?.trim() || null,
      input.changeSummary?.trim() || null,
      actor.id,
      expiresAt.toISOString(),
    ],
  );

  const uploadToken = encodeToken(
    {
      v: 1,
      uploadIntentId,
      actorId: actor.id,
      expectedByteSize: input.byteSize,
      expiresAt: expiresAt.getTime(),
    },
    signingSecret,
  );

  return { uploadIntentId, uploadToken, expiresAt };
}
