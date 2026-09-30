import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  FakeMalwareScanner,
  FakeMetadataExtractor,
  FakeRichDocumentParser,
} from "../../packages/file-processing/src/fakes";
import type {
  MalwareScannerPort,
  MetadataExtractorPort,
  RichDocumentParserPort,
} from "../../packages/file-processing/src/types";
import { processCompletedUpload } from "../../packages/application/src/files/process-upload";
import { FakeObjectStorage } from "../../packages/storage/src/fake";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("file processing failure and idempotency", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('file-runtime-team', 'File Runtime Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('file-runtime-lead', 'file-runtime-team', 'lead@file-runtime.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('file-runtime-portfolio', 'file-runtime-team', 'Portfolio')",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createProject(projectId: string): Promise<void> {
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'file-runtime-portfolio', $2, 'file-runtime-lead')",
      [projectId, projectId],
    );
  }

  async function seedUpload(
    storage: FakeObjectStorage,
    input: {
      intentId: string;
      projectId: string;
      bytes: Uint8Array;
      researchFileId?: string;
      proposedTitle?: string;
      quarantineKey?: string;
      originalFilename?: string;
      changeSummary?: string;
    },
  ): Promise<{ sha256: string; quarantineKey: string }> {
    const quarantineKey = input.quarantineKey ?? `uploads/${input.intentId}`;
    await storage.putObject(
      { bucket: "runtime-quarantine", key: quarantineKey },
      input.bytes,
      "application/octet-stream",
    );
    await testDb.client.sql.unsafe(
      `insert into file_upload_intents
        (id, project_id, research_file_id, proposed_title, file_kind, access_class,
         original_filename, expected_byte_size, declared_media_type, change_summary,
         state, tus_upload_id, quarantine_bucket, quarantine_key, created_by, expires_at)
       values ($1, $2, $3, $4, 'literature', 'project', $5, $6, 'application/pdf', $7,
               'uploaded_quarantine', $8, 'runtime-quarantine', $9,
               'file-runtime-lead', now() + interval '1 hour')`,
      [
        input.intentId,
        input.projectId,
        input.researchFileId ?? null,
        input.proposedTitle ?? null,
        input.originalFilename ?? `${input.intentId}.pdf`,
        input.bytes.byteLength,
        input.changeSummary ?? null,
        `tus-${input.intentId}`,
        quarantineKey,
      ],
    );
    return {
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      quarantineKey,
    };
  }

  function dependencies(
    storage: FakeObjectStorage,
    overrides: {
      scanner?: MalwareScannerPort;
      metadataExtractor?: MetadataExtractorPort;
      richParser?: RichDocumentParserPort;
    } = {},
  ) {
    return {
      storage,
      scanner:
        overrides.scanner ??
        new FakeMalwareScanner({
          verdict: "clean",
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
      metadataExtractor:
        overrides.metadataExtractor ??
        new FakeMetadataExtractor({
          mediaTypeDetected: "application/pdf",
          metadataText: '{"Content-Type":"application/pdf"}',
          extractedText: "fallback extracted text",
          processorVersion: "tika-test",
        }),
      richParser:
        overrides.richParser ??
        new FakeRichDocumentParser({
          supported: true,
          processorVersion: "docling-test",
          artifacts: [{ kind: "markdown", text: "# parsed" }],
        }),
      quarantineBucket: "runtime-quarantine",
      readyBucket: "runtime-ready",
      readyPrefix: "ready/",
      derivedPrefix: "derived/",
      maxExtractedSearchBytes: 4096,
      metrics: {
        increment(_name: string) {},
        observe(_name: string, _value: number) {},
      },
    };
  }

  it("quarantines malware without creating a formal file version", async () => {
    const projectId = "malware-project";
    await createProject(projectId);
    const storage = new FakeObjectStorage();
    const bytes = Buffer.from("malware-marker-content");
    const seeded = await seedUpload(storage, {
      intentId: "malware-intent",
      projectId,
      proposedTitle: "Rejected document",
      bytes,
    });

    const result = await processCompletedUpload(
      testDb.client.sql,
      "malware-intent",
      dependencies(storage, {
        scanner: new FakeMalwareScanner({
          verdict: "malware",
          signatureName: "Fake-Test-Signature",
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
      }),
    );

    expect(result).toBe("rejected_malware");
    const intents = await testDb.client.sql.unsafe(
      "select state from file_upload_intents where id = 'malware-intent'",
    );
    expect(intents[0]?.state).toBe("rejected_malware");

    const versions = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = $1`,
      [projectId],
    );
    expect(versions[0]?.count).toBe(0);

    const blobs = await testDb.client.sql.unsafe(
      "select sha256, storage_key, quarantine_state from file_blobs where sha256 = $1",
      [seeded.sha256],
    );
    expect(blobs).toContainEqual(
      expect.objectContaining({
        sha256: seeded.sha256,
        storage_key: seeded.quarantineKey,
        quarantine_state: "rejected",
      }),
    );
    expect(
      storage.listObjectRefs(),
    ).toContainEqual({ bucket: "runtime-quarantine", key: seeded.quarantineKey });

    const events = await testDb.client.sql.unsafe(
      "select event_type, payload from research_events where project_id = $1",
      [projectId],
    );
    expect(events.map((row) => row.event_type)).toContain("FILE_SCAN_REJECTED");
    expect(JSON.stringify(events)).not.toContain("malware-marker-content");
  });

  it("marks scanner infrastructure failure retryable and later finalizes exactly once", async () => {
    const projectId = "scanner-retry-project";
    await createProject(projectId);
    const storage = new FakeObjectStorage();
    const bytes = Buffer.from("scanner-retry-content");
    await seedUpload(storage, {
      intentId: "scanner-retry-intent",
      projectId,
      proposedTitle: "Retry document",
      bytes,
    });

    await expect(
      processCompletedUpload(
        testDb.client.sql,
        "scanner-retry-intent",
        dependencies(storage, {
          scanner: new FakeMalwareScanner({ errorCode: "ECONNREFUSED secret-host:3310" }),
        }),
      ),
    ).rejects.toThrow(/SCAN_FAILED/i);

    const failed = await testDb.client.sql.unsafe(
      "select state from file_upload_intents where id = 'scanner-retry-intent'",
    );
    expect(failed[0]?.state).toBe("processing_failed");
    expect(storage.listObjectRefs()).toContainEqual({
      bucket: "runtime-quarantine",
      key: "uploads/scanner-retry-intent",
    });

    const failedAttempts = await testDb.client.sql.unsafe(
      `select status, error_code
       from file_ingest_processor_attempts
       where upload_intent_id = 'scanner-retry-intent' and processor_name = 'clamav'`,
    );
    expect(failedAttempts).toContainEqual(
      expect.objectContaining({ status: "failed", error_code: "SCAN_FAILED" }),
    );
    expect(JSON.stringify(failedAttempts)).not.toContain("secret-host");

    const retried = await processCompletedUpload(
      testDb.client.sql,
      "scanner-retry-intent",
      dependencies(storage),
    );
    expect(retried).toBe("ready");

    const versions = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = $1`,
      [projectId],
    );
    expect(versions[0]?.count).toBe(1);
  });

  it("keeps a clean file ready when rich parsing fails after Tika fallback", async () => {
    const projectId = "parse-fallback-project";
    await createProject(projectId);
    const storage = new FakeObjectStorage();
    await seedUpload(storage, {
      intentId: "parse-fallback-intent",
      projectId,
      proposedTitle: "Fallback document",
      bytes: Buffer.from("parse-fallback-content"),
    });

    const result = await processCompletedUpload(
      testDb.client.sql,
      "parse-fallback-intent",
      dependencies(storage, {
        richParser: new FakeRichDocumentParser({ errorCode: "REMOTE_PARSER_SECRET_URL" }),
      }),
    );

    expect(result).toBe("ready_with_parse_error");
    const rows = await testDb.client.sql.unsafe(
      `select fv.parse_status, rf.current_version_id, fv.id as file_version_id
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = $1`,
      [projectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      parse_status: "failed",
      current_version_id: rows[0]?.file_version_id,
    });

    const processing = await testDb.client.sql.unsafe(
      `select status, error_code
       from file_processing_records
       where file_version_id = $1 and processor_name = 'docling'`,
      [rows[0]?.file_version_id],
    );
    expect(processing).toContainEqual(
      expect.objectContaining({ status: "failed", error_code: "RICH_PARSE_FAILED" }),
    );
    expect(JSON.stringify(processing)).not.toContain("REMOTE_PARSER_SECRET_URL");

    const events = await testDb.client.sql.unsafe(
      "select event_type from research_events where project_id = $1",
      [projectId],
    );
    expect(events.map((row) => row.event_type)).toContain("FILE_PARSE_FAILED");
  });

  it("deduplicates repeated delivery and concurrent same-file finalization without changing scientific state", async () => {
    const projectId = "concurrent-file-project";
    await createProject(projectId);
    await testDb.client.sql.unsafe(
      `insert into research_files
        (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
       values ('concurrent-research-file', $1, 'Concurrent paper', 'literature',
               'project', 'active', 'file-runtime-lead')`,
      [projectId],
    );

    const beforeScientific = await testDb.client.sql.unsafe(
      `select
         (select count(*)::int from scientific_decisions where project_id = $1) as decisions,
         (select count(*)::int from research_results where project_id = $1) as results`,
      [projectId],
    );

    const storage = new FakeObjectStorage();
    const sharedBytes = Buffer.from("same-physical-content");
    await seedUpload(storage, {
      intentId: "concurrent-intent-a",
      projectId,
      researchFileId: "concurrent-research-file",
      changeSummary: "version A",
      bytes: sharedBytes,
    });
    await seedUpload(storage, {
      intentId: "concurrent-intent-b",
      projectId,
      researchFileId: "concurrent-research-file",
      changeSummary: "version B",
      bytes: sharedBytes,
    });

    const [left, right] = await Promise.all([
      processCompletedUpload(
        testDb.client.sql,
        "concurrent-intent-a",
        dependencies(storage),
      ),
      processCompletedUpload(
        testDb.client.sql,
        "concurrent-intent-b",
        dependencies(storage),
      ),
    ]);
    expect([left, right].sort()).toEqual(["ready", "ready"]);

    const duplicate = await processCompletedUpload(
      testDb.client.sql,
      "concurrent-intent-a",
      dependencies(storage),
    );
    expect(duplicate).toBe("already_terminal");

    const versions = await testDb.client.sql.unsafe(
      `select fv.id, fv.version_number, fv.blob_id, rf.current_version_id
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where fv.research_file_id = 'concurrent-research-file'
       order by fv.version_number`,
    );
    expect(versions.map((row) => Number(row.version_number))).toEqual([1, 2]);
    expect(versions[1]?.id).toBe(versions[1]?.current_version_id);
    expect(new Set(versions.map((row) => String(row.blob_id))).size).toBe(1);

    const blobCount = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from file_blobs
       where sha256 = $1 and storage_backend = 's3'`,
      [createHash("sha256").update(sharedBytes).digest("hex")],
    );
    expect(blobCount[0]?.count).toBe(1);

    const afterScientific = await testDb.client.sql.unsafe(
      `select
         (select count(*)::int from scientific_decisions where project_id = $1) as decisions,
         (select count(*)::int from research_results where project_id = $1) as results`,
      [projectId],
    );
    expect(afterScientific[0]).toEqual(beforeScientific[0]);
  });
});
