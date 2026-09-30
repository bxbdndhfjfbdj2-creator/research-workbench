import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";
import type { ObjectStoragePort, StorageObjectRef } from "@research-workbench/storage/src/types";
import type {
  MalwareScannerPort,
  MetadataExtractorPort,
  RichDocumentParserPort,
  RichDocumentArtifact,
} from "@research-workbench/file-processing/src/types";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import { upsertFileSearchProjection } from "./search-projection";

export interface FileMetricsPort {
  increment(name: string): void;
  observe(name: string, value: number): void;
}

export type FileProcessingDependencies = {
  storage: ObjectStoragePort;
  scanner: MalwareScannerPort;
  metadataExtractor: MetadataExtractorPort;
  richParser: RichDocumentParserPort;
  quarantineBucket: string;
  readyBucket: string;
  readyPrefix: string;
  derivedPrefix: string;
  maxExtractedSearchBytes: number;
  metrics: FileMetricsPort;
};

type UploadIntentRow = {
  id: string;
  project_id: string;
  research_file_id: string | null;
  proposed_title: string | null;
  file_kind: string;
  access_class: string;
  original_filename: string;
  expected_byte_size: number | string;
  declared_media_type: string | null;
  change_summary: string | null;
  state: string;
  quarantine_bucket: string | null;
  quarantine_key: string | null;
  created_by: string;
};

type ProcessorFact = {
  kind: string;
  name: string;
  version: string;
  status: "succeeded" | "failed";
  outputRefs: string[];
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date;
};

function requireText(value: string | null, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function loadIntent(sql: Pick<DatabaseSql, "unsafe">, id: string): Promise<UploadIntentRow> {
  const rows = (await sql.unsafe(
    `select id, project_id, research_file_id, proposed_title, file_kind, access_class,
            original_filename, expected_byte_size, declared_media_type, change_summary,
            state, quarantine_bucket, quarantine_key, created_by
     from file_upload_intents
     where id = $1
     limit 1`,
    [id],
  )) as readonly UploadIntentRow[];
  const row = rows[0];
  if (!row) throw new Error("Upload intent not found");
  return row;
}

async function updateIntentState(
  sql: Pick<DatabaseSql, "unsafe">,
  id: string,
  state: string,
): Promise<void> {
  await sql.unsafe(
    "update file_upload_intents set state = $2, updated_at = now() where id = $1",
    [id, state],
  );
}

async function streamToTemporaryFile(
  body: NodeJS.ReadableStream,
): Promise<{ directory: string; path: string; byteSize: number; sha256: string }> {
  const directory = await mkdtemp(join(tmpdir(), "research-workbench-file-"));
  const path = join(directory, "input.bin");
  const output = createWriteStream(path, { flags: "wx" });
  const hash = createHash("sha256");
  let byteSize = 0;

  try {
    for await (const chunk of body as AsyncIterable<unknown>) {
      const bytes =
        typeof chunk === "string"
          ? Buffer.from(chunk)
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : null;
      if (!bytes) throw new Error("Unsupported storage stream chunk");
      byteSize += bytes.byteLength;
      hash.update(bytes);
      if (!output.write(bytes)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
    return { directory, path, byteSize, sha256: hash.digest("hex") };
  } catch (error) {
    output.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function storageOutputRef(ref: StorageObjectRef): string {
  return `storage:${ref.bucket}/${ref.key}`;
}

async function putDerived(
  storage: ObjectStoragePort,
  ref: StorageObjectRef,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  await storage.putObject(ref, bytes, contentType);
  return storageOutputRef(ref);
}

async function startAttempt(
  sql: DatabaseSql,
  uploadIntentId: string,
  processorKind: string,
  processorName: string,
  inputHash: string,
): Promise<{ id: string; startedAt: Date }> {
  const id = randomUUID();
  await sql.unsafe(
    `insert into file_ingest_processor_attempts
      (id, upload_intent_id, processor_kind, processor_name, processor_version,
       input_hash, status, started_at)
     values ($1, $2, $3, $4, 'pending', $5, 'running', now())
     on conflict do nothing`,
    [id, uploadIntentId, processorKind, processorName, inputHash],
  );
  const rows = await sql.unsafe(
    `select id, started_at
     from file_ingest_processor_attempts
     where upload_intent_id = $1
       and processor_name = $2
       and input_hash = $3
     order by created_at desc
     limit 1`,
    [uploadIntentId, processorName, inputHash],
  );
  const row = rows[0];
  if (!row) throw new Error("Processing attempt could not be created");
  return { id: String(row.id), startedAt: new Date(row.started_at as string | Date) };
}

async function finishAttempt(
  sql: DatabaseSql,
  id: string,
  version: string,
  outputRefs: string[],
): Promise<Date> {
  const rows = await sql.unsafe(
    `update file_ingest_processor_attempts
     set processor_version = $2,
         status = 'succeeded',
         output_refs = $3::jsonb,
         error_code = null,
         finished_at = now(),
         updated_at = now()
     where id = $1
     returning finished_at`,
    [id, version, JSON.stringify(outputRefs)],
  );
  const row = rows[0];
  if (!row) throw new Error("Processing attempt completion returned no row");
  return new Date(row.finished_at as string | Date);
}

function doclingKey(
  derivedPrefix: string,
  sha256: string,
  artifact: RichDocumentArtifact,
): string {
  const extension =
    artifact.kind === "markdown" ? "md" : artifact.kind === "json" ? "json" : "html";
  return `${derivedPrefix}${sha256}/docling/document.${extension}`;
}

async function finalizeCleanVersion(
  sql: DatabaseSql,
  intent: UploadIntentRow,
  facts: {
    sha256: string;
    byteSize: number;
    mediaType: string;
    readyKey: string;
    extractedText: string | null;
    processorFacts: ProcessorFact[];
  },
  deps: FileProcessingDependencies,
): Promise<void> {
  await runInTransaction(sql, async (tx) => {
    const freshRows = (await tx.unsafe(
      `select state, research_file_id
       from file_upload_intents
       where id = $1
       for update`,
      [intent.id],
    )) as ReadonlyArray<{ state: string; research_file_id: string | null }>;
    const fresh = freshRows[0];
    if (!fresh) throw new Error("Upload intent disappeared during finalization");
    if (fresh.state === "ready" || fresh.state === "ready_with_parse_error") return;

    let researchFileId = fresh.research_file_id;
    let title: string;

    if (researchFileId) {
      const fileRows = await tx.unsafe(
        `select id, title
         from research_files
         where id = $1 and project_id = $2
         for update`,
        [researchFileId, intent.project_id],
      );
      const file = fileRows[0];
      if (!file) throw new Error("Research file not found for upload finalization");
      title = String(file.title);
    } else {
      researchFileId = randomUUID();
      title = requireText(intent.proposed_title, "Research file title");
      await tx.unsafe(
        `insert into research_files
          (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
         values ($1, $2, $3, $4, $5, 'draft', $6)`,
        [
          researchFileId,
          intent.project_id,
          title,
          intent.file_kind,
          intent.access_class,
          intent.created_by,
        ],
      );
      await tx.unsafe(
        "update file_upload_intents set research_file_id = $2 where id = $1",
        [intent.id, researchFileId],
      );
      await appendResearchEvent(tx, {
        id: randomUUID(),
        projectId: intent.project_id,
        eventType: "RESEARCH_FILE_CREATED",
        actor: { type: "human", id: intent.created_by },
        payload: {
          researchFileId,
          fileKind: intent.file_kind,
          accessClass: intent.access_class,
        },
      });
      await enqueueOutbox(tx, {
        id: randomUUID(),
        eventType: "research.file.created",
        payload: { projectId: intent.project_id, researchFileId },
      });
    }

    const blobId = randomUUID();
    await tx.unsafe(
      `insert into file_blobs
        (id, sha256, storage_backend, storage_key, byte_size, media_type_detected, quarantine_state)
       values ($1, $2, 's3', $3, $4, $5, 'ready')
       on conflict (storage_backend, sha256) do nothing`,
      [blobId, facts.sha256, facts.readyKey, facts.byteSize, facts.mediaType],
    );
    const blobRows = await tx.unsafe(
      "select id from file_blobs where storage_backend = 's3' and sha256 = $1 limit 1",
      [facts.sha256],
    );
    const canonicalBlobId = blobRows[0]?.id;
    if (!canonicalBlobId) throw new Error("Ready file blob could not be resolved");

    const versionRows = await tx.unsafe(
      "select coalesce(max(version_number), 0)::int + 1 as next_version from file_versions where research_file_id = $1",
      [researchFileId],
    );
    const versionNumber = Number(versionRows[0]?.next_version ?? 1);
    const fileVersionId = randomUUID();

    await tx.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, blob_id, original_filename, media_type,
         byte_size, sha256, source_kind, source_metadata, change_summary,
         scan_status, parse_status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'upload', $9::jsonb, $10,
               'passed', 'parsed', $11)`,
      [
        fileVersionId,
        researchFileId,
        versionNumber,
        canonicalBlobId,
        intent.original_filename,
        facts.mediaType,
        facts.byteSize,
        facts.sha256,
        JSON.stringify({
          uploadIntentId: intent.id,
          tusUploadId: null,
        }),
        intent.change_summary,
        intent.created_by,
      ],
    );

    for (const fact of facts.processorFacts) {
      await tx.unsafe(
        `insert into file_processing_records
          (id, file_version_id, processor_kind, processor_name, processor_version,
           status, input_hash, output_refs, error_code, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          randomUUID(),
          fileVersionId,
          fact.kind,
          fact.name,
          fact.version,
          fact.status,
          facts.sha256,
          JSON.stringify(fact.outputRefs),
          fact.errorCode,
          fact.startedAt.toISOString(),
          fact.finishedAt.toISOString(),
        ],
      );
    }

    await upsertFileSearchProjection(tx, {
      fileVersionId,
      researchFileId,
      projectId: intent.project_id,
      title,
      originalFilename: intent.original_filename,
      extractedText: facts.extractedText,
      mediaTypeDetected: facts.mediaType,
      maxExtractedSearchBytes: deps.maxExtractedSearchBytes,
    });

    await tx.unsafe(
      `update research_files
       set current_version_id = $2, lifecycle_state = 'active'
       where id = $1`,
      [researchFileId, fileVersionId],
    );
    await tx.unsafe(
      `update file_upload_intents
       set state = 'ready', updated_at = now()
       where id = $1`,
      [intent.id],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: intent.project_id,
      eventType: "FILE_SCAN_COMPLETED",
      actor: { type: "human", id: intent.created_by },
      payload: { uploadIntentId: intent.id, sha256: facts.sha256, verdict: "clean" },
    });
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: intent.project_id,
      eventType: "FILE_PARSE_COMPLETED",
      actor: { type: "human", id: intent.created_by },
      payload: { uploadIntentId: intent.id, fileVersionId, sha256: facts.sha256 },
    });
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: intent.project_id,
      eventType: "FILE_VERSION_CREATED",
      actor: { type: "human", id: intent.created_by },
      payload: {
        researchFileId,
        fileVersionId,
        versionNumber,
        sourceKind: "upload",
        sha256: facts.sha256,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "file.version.created",
      payload: {
        projectId: intent.project_id,
        researchFileId,
        fileVersionId,
        versionNumber,
      },
    });
  });
}

export async function processCompletedUpload(
  sql: DatabaseSql,
  uploadIntentId: string,
  deps: FileProcessingDependencies,
): Promise<"ready" | "ready_with_parse_error" | "rejected_malware" | "already_terminal"> {
  const intent = await loadIntent(sql, uploadIntentId);
  if (intent.state === "ready" || intent.state === "ready_with_parse_error" || intent.state === "rejected_malware") {
    return "already_terminal";
  }
  if (intent.state !== "uploaded_quarantine") {
    throw new Error("Upload intent is not ready for processing");
  }
  if (intent.quarantine_bucket !== deps.quarantineBucket) {
    throw new Error("Upload intent quarantine bucket does not match processing policy");
  }
  const quarantineKey = requireText(intent.quarantine_key, "Quarantine key");
  const quarantineRef = { bucket: deps.quarantineBucket, key: quarantineKey };

  await updateIntentState(sql, intent.id, "scanning");
  const stored = await deps.storage.readObject(quarantineRef);
  const local = await streamToTemporaryFile(stored.body);

  try {
    if (local.byteSize !== Number(intent.expected_byte_size)) {
      throw new Error("Uploaded byte size does not match upload intent");
    }

    const scanStarted = Date.now();
    const scanAttempt = await startAttempt(sql, intent.id, "scanner", "clamav", local.sha256);
    const scan = await deps.scanner.scan({
      path: local.path,
      originalFilename: intent.original_filename,
      byteSize: local.byteSize,
      sha256: local.sha256,
    });
    deps.metrics.observe("file.scan.duration_ms", Date.now() - scanStarted);
    if (scan.verdict !== "clean") {
      throw new Error("MALWARE_PATH_NOT_IMPLEMENTED");
    }
    const scanRef = {
      bucket: deps.readyBucket,
      key: `${deps.derivedPrefix}${local.sha256}/scan/clamav.json`,
    };
    const scanOutput = await putDerived(
      deps.storage,
      scanRef,
      new TextEncoder().encode(
        JSON.stringify({
          verdict: scan.verdict,
          signatureName: scan.signatureName,
          scannerVersion: scan.scannerVersion,
          signatureDatabaseVersion: scan.signatureDatabaseVersion,
        }),
      ),
      "application/json",
    );
    const scanFinishedAt = await finishAttempt(
      sql,
      scanAttempt.id,
      scan.scannerVersion,
      [scanOutput],
    );

    await updateIntentState(sql, intent.id, "metadata_processing");
    const parseStarted = Date.now();
    const metadataAttempt = await startAttempt(sql, intent.id, "metadata", "tika", local.sha256);
    const metadata = await deps.metadataExtractor.extract({
      path: local.path,
      originalFilename: intent.original_filename,
      byteSize: local.byteSize,
      sha256: local.sha256,
    });
    const metadataRef = {
      bucket: deps.readyBucket,
      key: `${deps.derivedPrefix}${local.sha256}/tika/metadata.json`,
    };
    const metadataOutputs = [
      await putDerived(
        deps.storage,
        metadataRef,
        metadata.metadataArtifact,
        "application/json",
      ),
    ];
    let extractedText: string | null = null;
    if (metadata.textArtifact) {
      const textRef = {
        bucket: deps.readyBucket,
        key: `${deps.derivedPrefix}${local.sha256}/tika/text.txt`,
      };
      metadataOutputs.push(
        await putDerived(
          deps.storage,
          textRef,
          metadata.textArtifact,
          "text/plain; charset=utf-8",
        ),
      );
      extractedText = new TextDecoder().decode(metadata.textArtifact);
    }
    const metadataFinishedAt = await finishAttempt(
      sql,
      metadataAttempt.id,
      metadata.processorVersion,
      metadataOutputs,
    );

    await updateIntentState(sql, intent.id, "parsing");
    const richAttempt = await startAttempt(sql, intent.id, "rich_parser", "docling", local.sha256);
    const rich = await deps.richParser.parse(
      {
        path: local.path,
        originalFilename: intent.original_filename,
        byteSize: local.byteSize,
        sha256: local.sha256,
      },
      metadata.mediaTypeDetected,
    );
    const richOutputs: string[] = [];
    for (const artifact of rich.artifacts) {
      const ref = {
        bucket: deps.readyBucket,
        key: doclingKey(deps.derivedPrefix, local.sha256, artifact),
      };
      richOutputs.push(
        await putDerived(
          deps.storage,
          ref,
          artifact.bytes,
          artifact.kind === "json"
            ? "application/json"
            : artifact.kind === "html"
              ? "text/html; charset=utf-8"
              : "text/markdown; charset=utf-8",
        ),
      );
    }
    if (richOutputs.length === 0) {
      richOutputs.push(
        await putDerived(
          deps.storage,
          {
            bucket: deps.readyBucket,
            key: `${deps.derivedPrefix}${local.sha256}/docling/unsupported.json`,
          },
          new TextEncoder().encode(JSON.stringify({ supported: false })),
          "application/json",
        ),
      );
    }
    const richFinishedAt = await finishAttempt(
      sql,
      richAttempt.id,
      rich.processorVersion,
      richOutputs,
    );
    deps.metrics.observe("file.parse.duration_ms", Date.now() - parseStarted);

    const readyKey = `${deps.readyPrefix}${local.sha256.slice(0, 2)}/${local.sha256}`;
    const readyRef = { bucket: deps.readyBucket, key: readyKey };
    if (!(await deps.storage.headObject(readyRef))) {
      await deps.storage.copyObject(quarantineRef, readyRef);
    }

    await updateIntentState(sql, intent.id, "accepted");
    await finalizeCleanVersion(
      sql,
      intent,
      {
        sha256: local.sha256,
        byteSize: local.byteSize,
        mediaType: metadata.mediaTypeDetected,
        readyKey,
        extractedText,
        processorFacts: [
          {
            kind: "scanner",
            name: "clamav",
            version: scan.scannerVersion,
            status: "succeeded",
            outputRefs: [scanOutput],
            errorCode: null,
            startedAt: scanAttempt.startedAt,
            finishedAt: scanFinishedAt,
          },
          {
            kind: "metadata",
            name: "tika",
            version: metadata.processorVersion,
            status: "succeeded",
            outputRefs: metadataOutputs,
            errorCode: null,
            startedAt: metadataAttempt.startedAt,
            finishedAt: metadataFinishedAt,
          },
          {
            kind: "rich_parser",
            name: "docling",
            version: rich.processorVersion,
            status: "succeeded",
            outputRefs: richOutputs,
            errorCode: null,
            startedAt: richAttempt.startedAt,
            finishedAt: richFinishedAt,
          },
        ],
      },
      deps,
    );

    await deps.storage.deleteObject(quarantineRef);
    deps.metrics.increment("file.upload.completed");
    return "ready";
  } finally {
    await rm(local.directory, { recursive: true, force: true });
  }
}

export function createFileOutboxHandler(
  sql: DatabaseSql,
  deps: FileProcessingDependencies,
) {
  return async (record: { eventType: string; payload: JsonValue }): Promise<boolean> => {
    if (record.eventType !== "file.upload.completed") return false;
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
      throw new Error("Invalid file.upload.completed payload");
    }
    const uploadIntentId = record.payload.uploadIntentId;
    if (typeof uploadIntentId !== "string" || !uploadIntentId) {
      throw new Error("file.upload.completed requires uploadIntentId");
    }
    await processCompletedUpload(sql, uploadIntentId, deps);
    return true;
  };
}
