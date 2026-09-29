import type { TransactionSql } from "../transactions";

export type FileSearchProjectionInput = {
  fileVersionId: string;
  researchFileId: string;
  projectId: string;
  title: string;
  originalFilename: string;
  extractedText: string | null;
  mediaTypeDetected: string;
  maxExtractedSearchBytes: number;
};

function truncateUtf8(value: string | null, maxBytes: number): string | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Search extraction byte cap must be a positive integer");
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/u, "");
}

export async function upsertFileSearchProjection(
  tx: TransactionSql,
  input: FileSearchProjectionInput,
): Promise<void> {
  const extractedText = truncateUtf8(
    input.extractedText,
    input.maxExtractedSearchBytes,
  );
  const metadata = { mediaTypeDetected: input.mediaTypeDetected };
  await tx.unsafe(
    `insert into file_search_documents
      (file_version_id, research_file_id, project_id, title, original_filename,
       extracted_text, metadata, search_vector)
     values (
       $1, $2, $3, $4, $5, $6, $7::jsonb,
       to_tsvector('simple', concat_ws(' ', $4, $5, coalesce($6, '')))
     )
     on conflict (file_version_id) do update
     set title = excluded.title,
         original_filename = excluded.original_filename,
         extracted_text = excluded.extracted_text,
         metadata = excluded.metadata,
         search_vector = excluded.search_vector,
         updated_at = now()`,
    [
      input.fileVersionId,
      input.researchFileId,
      input.projectId,
      input.title,
      input.originalFilename,
      extractedText,
      JSON.stringify(metadata),
    ],
  );
}
