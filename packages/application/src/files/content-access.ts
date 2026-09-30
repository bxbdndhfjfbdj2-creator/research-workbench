import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  assertFileAccessClass,
  type FileAccessClass,
} from "@research-workbench/domain/src/research-file";
import type { StorageObjectRef } from "@research-workbench/storage/src/types";
import { authorizeProjectAccess } from "../auth/authorize";

type FileContentRow = {
  project_id: string;
  access_class: string;
  original_filename: string;
  media_type: string | null;
  byte_size: number | string | null;
  source_kind: string;
  blob_id: string | null;
  external_reference_id: string | null;
  scan_status: string;
  storage_backend: string | null;
  storage_key: string | null;
  quarantine_state: string | null;
};

export type FileContentDescriptor = {
  projectId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  storageRef: StorageObjectRef;
  accessClass: FileAccessClass;
};

export async function getFileContentDescriptor(
  sql: DatabaseSql,
  fileVersionId: string,
  actorId: string,
): Promise<FileContentDescriptor> {
  const versionId = fileVersionId.trim();
  if (!versionId) throw new Error("File version id is required");

  const rows = (await sql.unsafe(
    `select
       rf.project_id,
       rf.access_class,
       fv.original_filename,
       fv.media_type,
       fv.byte_size,
       fv.source_kind,
       fv.blob_id,
       fv.external_reference_id,
       fv.scan_status,
       fb.storage_backend,
       fb.storage_key,
       fb.quarantine_state
     from file_versions fv
     join research_files rf on rf.id = fv.research_file_id
     left join file_blobs fb on fb.id = fv.blob_id
     where fv.id = $1
     limit 1`,
    [versionId],
  )) as readonly FileContentRow[];

  const row = rows[0];
  if (!row) throw new Error("File version not found");

  await authorizeProjectAccess(sql, actorId, row.project_id, "read");

  assertFileAccessClass(row.access_class);

  if (
    row.source_kind !== "upload" ||
    !row.blob_id ||
    row.external_reference_id ||
    !row.storage_key
  ) {
    throw new Error("File version has no blob content");
  }
  if (
    row.scan_status !== "passed" ||
    row.quarantine_state !== "ready"
  ) {
    throw new Error("File content is not ready for access");
  }
  if (row.storage_backend !== "s3") {
    throw new Error("Unsupported file storage backend");
  }

  const byteSize = Number(row.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("File content has an invalid byte size");
  }
  const mediaType = row.media_type?.trim();
  if (!mediaType) throw new Error("File content has no media type");

  return {
    projectId: row.project_id,
    originalFilename: row.original_filename,
    mediaType,
    byteSize,
    storageRef: {
      bucket: "ready",
      key: row.storage_key,
    },
    accessClass: row.access_class,
  };
}
