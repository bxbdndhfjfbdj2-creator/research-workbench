import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";
import { FakeObjectStorage } from "../../../storage/src/fake";
import {
  FakeMalwareScanner,
  FakeMetadataExtractor,
  FakeRichDocumentParser,
} from "../../../file-processing/src/fakes";

describe("completed upload processing", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('processing-team', 'Processing Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('processing-lead', 'processing-team', 'lead@processing.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('processing-portfolio', 'processing-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('processing-project', 'processing-portfolio', 'Project', 'processing-lead')",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("finalizes a clean upload into one immutable version with derived provenance", async () => {
    const modulePath = "./process-upload";
    const { processCompletedUpload } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const source = Buffer.from("phase-4a-clean-content");
    const sha256 = createHash("sha256").update(source).digest("hex");
    const quarantineRef = {
      bucket: "phase4a-quarantine",
      key: "uploads/opaque-123",
    };
    await storage.putObject(quarantineRef, source, "application/octet-stream");

    await testDb.client.sql.unsafe(
      `insert into file_upload_intents
        (id, project_id, proposed_title, file_kind, access_class, original_filename,
         expected_byte_size, declared_media_type, state, tus_upload_id,
         quarantine_bucket, quarantine_key, created_by, expires_at)
       values
        ('upload-clean-1', 'processing-project', 'Clean paper', 'literature', 'project',
         'paper.pdf', $1, 'application/pdf', 'uploaded_quarantine', 'tus-clean-1',
         'phase4a-quarantine', 'uploads/opaque-123', 'processing-lead',
         now() + interval '1 hour')`,
      [source.byteLength],
    );

    const metrics: Array<{ name: string; value?: number }> = [];
    const result = await processCompletedUpload(
      testDb.client.sql,
      "upload-clean-1",
      {
        storage,
        scanner: new FakeMalwareScanner({
          verdict: "clean",
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
        metadataExtractor: new FakeMetadataExtractor({
          mediaTypeDetected: "application/pdf",
          metadataText: '{"Content-Type":"application/pdf"}',
          extractedText: "bounded extracted research text",
          processorVersion: "tika-test",
        }),
        richParser: new FakeRichDocumentParser({
          supported: true,
          processorVersion: "docling-test",
          artifacts: [
            { kind: "markdown", text: "# Parsed paper" },
            { kind: "json", text: '{"type":"document"}' },
          ],
        }),
        quarantineBucket: "phase4a-quarantine",
        readyBucket: "phase4a-ready",
        readyPrefix: "ready/",
        derivedPrefix: "derived/",
        maxExtractedSearchBytes: 4_096,
        metrics: {
          increment(name: string) {
            metrics.push({ name });
          },
          observe(name: string, value: number) {
            metrics.push({ name, value });
          },
        },
      },
    );

    expect(result).toBe("ready");

    const versions = await testDb.client.sql.unsafe(
      `select fv.id, fv.version_number, fv.original_filename, fv.media_type,
              fv.byte_size, fv.sha256, fv.source_kind, fv.scan_status, fv.parse_status,
              rf.current_version_id, rf.lifecycle_state, fb.storage_key, fb.quarantine_state
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       join file_blobs fb on fb.id = fv.blob_id
       where rf.project_id = 'processing-project'`,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      original_filename: "paper.pdf",
      media_type: "application/pdf",
      sha256,
      source_kind: "upload",
      scan_status: "passed",
      parse_status: "parsed",
      lifecycle_state: "active",
      storage_key: `ready/${sha256.slice(0, 2)}/${sha256}`,
      quarantine_state: "ready",
    });
    expect(Number(versions[0]?.byte_size)).toBe(source.byteLength);
    expect(versions[0]?.current_version_id).toBe(versions[0]?.id);

    const processing = await testDb.client.sql.unsafe(
      "select processor_kind, processor_name, processor_version, status, input_hash, output_refs from file_processing_records order by processor_kind",
    );
    expect(processing).toHaveLength(3);
    expect(processing.every((row) => row.status === "succeeded")).toBe(true);
    expect(processing.every((row) => row.input_hash === sha256)).toBe(true);
    expect(processing.every((row) => Array.isArray(row.output_refs) && row.output_refs.length > 0)).toBe(true);

    const search = await testDb.client.sql.unsafe(
      "select title, original_filename, extracted_text, metadata from file_search_documents",
    );
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({
      title: "Clean paper",
      original_filename: "paper.pdf",
      extracted_text: "bounded extracted research text",
      metadata: { mediaTypeDetected: "application/pdf" },
    });

    const events = await testDb.client.sql.unsafe(
      "select event_type, payload from research_events where project_id = 'processing-project' order by created_at, id",
    );
    expect(events.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "RESEARCH_FILE_CREATED",
        "FILE_SCAN_COMPLETED",
        "FILE_PARSE_COMPLETED",
        "FILE_VERSION_CREATED",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("bounded extracted research text");

    expect(storage.listObjectRefs()).toEqual(
      expect.arrayContaining([
        { bucket: "phase4a-ready", key: `ready/${sha256.slice(0, 2)}/${sha256}` },
        { bucket: "phase4a-ready", key: `derived/${sha256}/scan/clamav.json` },
        { bucket: "phase4a-ready", key: `derived/${sha256}/tika/metadata.json` },
        { bucket: "phase4a-ready", key: `derived/${sha256}/tika/text.txt` },
        { bucket: "phase4a-ready", key: `derived/${sha256}/docling/document.md` },
        { bucket: "phase4a-ready", key: `derived/${sha256}/docling/document.json` },
      ]),
    );
    expect(storage.listObjectRefs()).not.toContainEqual(quarantineRef);

    const intent = await testDb.client.sql.unsafe(
      "select state from file_upload_intents where id = 'upload-clean-1'",
    );
    expect(intent[0]?.state).toBe("ready");
    expect(metrics.map((item) => item.name)).toEqual(
      expect.arrayContaining(["file.scan.duration_ms", "file.parse.duration_ms", "file.upload.completed"]),
    );
  });
});
