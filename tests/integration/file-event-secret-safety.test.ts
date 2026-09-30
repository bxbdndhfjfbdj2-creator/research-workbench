import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { assertSecretSafe as assertResearchPayloadSecretSafe } from "../../packages/domain/src/events";
import { createFileUploadIntent } from "../../packages/application/src/files/upload-intent";
import { handleTusHook } from "../../packages/application/src/files/tusd-hook";
import { processCompletedUpload } from "../../packages/application/src/files/process-upload";
import { registerExternalDataVersion } from "../../packages/application/src/files/file-service";
import { createFileLink } from "../../packages/application/src/files/file-links";
import {
  FakeMalwareScanner,
  FakeMetadataExtractor,
  FakeRichDocumentParser,
} from "../../packages/file-processing/src/fakes";
import { FakeObjectStorage } from "../../packages/storage/src/fake";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("file event and secret safety", () => {
  let testDb: TestDatabase;

  const actor = { type: "human" as const, id: "file-safety-lead" };
  const projectId = "file-safety-project";
  const signingSecret = "UPLOAD_SIGNING_SECRET_MARKER_2026";
  const rawText = "RAW_DOCUMENT_TEXT_MARKER_2026";
  const tikaRaw = "TIKA_RAW_PAYLOAD_MARKER_2026";
  const doclingRaw = "DOCLING_RAW_PAYLOAD_MARKER_2026";
  const clamInternal = "CLAM_INTERNAL_LOG_MARKER_2026";
  const restrictedLocator =
    "secure-datalake://restricted-locator-marker-2026/study";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('file-safety-team', 'File Safety Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('file-safety-lead', 'file-safety-team', 'lead@file-safety.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('file-safety-portfolio', 'file-safety-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'file-safety-portfolio', 'Safety Project', 'file-safety-lead')",
      [projectId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('file-safety-membership', $1, 'file-safety-lead', 'lead')",
      [projectId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  function assertNoMarkerLeak(value: unknown, forbidden: string[]): void {
    const serialized = JSON.stringify(value);
    for (const marker of forbidden) {
      expect(serialized, `unsafe marker leaked: ${marker}`).not.toContain(marker);
    }
    expect(serialized).not.toMatch(/X-Amz-(Credential|Signature)=/i);
  }

  async function completeTusUpload(input: {
    title: string;
    filename: string;
    bytes: Buffer;
    tusUploadId: string;
  }): Promise<{ intentId: string; uploadToken: string; storage: FakeObjectStorage }> {
    const intent = await createFileUploadIntent(
      testDb.client.sql,
      projectId,
      {
        title: input.title,
        fileKind: "literature",
        accessClass: "project",
        originalFilename: input.filename,
        byteSize: input.bytes.byteLength,
        declaredMediaType: "text/plain",
      },
      actor,
      signingSecret,
      3600,
      10 * 1024 * 1024,
    );
    const metadata = { workbenchUploadId: intent.uploadIntentId };
    const policy = {
      quarantineBucket: "safety-quarantine",
      quarantinePrefix: "uploads/",
      maxFileBytes: 10 * 1024 * 1024,
    };

    await handleTusHook(
      testDb.client.sql,
      {
        type: "pre-create",
        upload: {
          id: null,
          size: input.bytes.byteLength,
          offset: 0,
          metadata,
        },
      },
      intent.uploadToken,
      policy,
      signingSecret,
    );

    const quarantineKey = `uploads/${input.tusUploadId}`;
    await handleTusHook(
      testDb.client.sql,
      {
        type: "post-finish",
        upload: {
          id: input.tusUploadId,
          size: input.bytes.byteLength,
          offset: input.bytes.byteLength,
          metadata,
          storage: {
            type: "s3store",
            bucket: policy.quarantineBucket,
            key: quarantineKey,
          },
        },
      },
      intent.uploadToken,
      policy,
      signingSecret,
    );

    const storage = new FakeObjectStorage();
    await storage.putObject(
      { bucket: policy.quarantineBucket, key: quarantineKey },
      input.bytes,
      "text/plain",
    );
    return {
      intentId: intent.uploadIntentId,
      uploadToken: intent.uploadToken,
      storage,
    };
  }

  it("rejects AWS credential-shaped research payload fields", () => {
    expect(() =>
      assertResearchPayloadSecretSafe({
        accessKeyId: "AWS_ACCESS_KEY_ID_MARKER_2026",
      }),
    ).toThrow(/Sensitive credential field/i);

    expect(() =>
      assertResearchPayloadSecretSafe({
        storage: {
          secretAccessKey: "AWS_SECRET_ACCESS_KEY_MARKER_2026",
        },
      }),
    ).toThrow(/Sensitive credential field/i);
  });

  it("keeps secrets and raw processor content out of governed facts", async () => {
    const beforeScientific = await testDb.client.sql.unsafe(
      `select
         (select count(*)::int from scientific_decisions where project_id = $1) as decisions,
         (select count(*)::int from research_results where project_id = $1) as results`,
      [projectId],
    );

    const metrics: Array<{ kind: "increment" | "observe"; name: string; value?: number }> = [];
    const clean = await completeTusUpload({
      title: "Clean safety file",
      filename: "clean-safety.txt",
      bytes: Buffer.from(rawText),
      tusUploadId: "tus-clean-safety",
    });
    const cleanResult = await processCompletedUpload(
      testDb.client.sql,
      clean.intentId,
      {
        storage: clean.storage,
        scanner: new FakeMalwareScanner({
          verdict: "clean",
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
        metadataExtractor: new FakeMetadataExtractor({
          mediaTypeDetected: "text/plain",
          metadataText: tikaRaw,
          extractedText: rawText,
          processorVersion: "tika-test",
        }),
        richParser: new FakeRichDocumentParser({
          supported: true,
          processorVersion: "docling-test",
          artifacts: [{ kind: "markdown", text: doclingRaw }],
        }),
        quarantineBucket: "safety-quarantine",
        readyBucket: "safety-ready",
        readyPrefix: "ready/",
        derivedPrefix: "derived/",
        maxExtractedSearchBytes: 4096,
        metrics: {
          increment(name: string) {
            metrics.push({ kind: "increment", name });
          },
          observe(name: string, value: number) {
            metrics.push({ kind: "observe", name, value });
          },
        },
      },
    );
    expect(cleanResult).toBe("ready");

    const cleanVersionRows = await testDb.client.sql.unsafe(
      `select fv.id
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = $1 and rf.title = 'Clean safety file'
       limit 1`,
      [projectId],
    );
    const cleanVersionId = String(cleanVersionRows[0]?.id ?? "");
    expect(cleanVersionId).not.toBe("");

    const malware = await completeTusUpload({
      title: "Rejected safety file",
      filename: "malware-safety.txt",
      bytes: Buffer.from("malware safety bytes"),
      tusUploadId: "tus-malware-safety",
    });
    const malwareResult = await processCompletedUpload(
      testDb.client.sql,
      malware.intentId,
      {
        storage: malware.storage,
        scanner: new FakeMalwareScanner({
          verdict: "malware",
          signatureName: clamInternal,
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
        metadataExtractor: new FakeMetadataExtractor({
          mediaTypeDetected: "text/plain",
          metadataText: tikaRaw,
          extractedText: rawText,
          processorVersion: "tika-test",
        }),
        richParser: new FakeRichDocumentParser({
          supported: true,
          processorVersion: "docling-test",
          artifacts: [{ kind: "markdown", text: doclingRaw }],
        }),
        quarantineBucket: "safety-quarantine",
        readyBucket: "safety-ready",
        readyPrefix: "ready/",
        derivedPrefix: "derived/",
        maxExtractedSearchBytes: 4096,
        metrics: {
          increment(name: string) {
            metrics.push({ kind: "increment", name });
          },
          observe(name: string, value: number) {
            metrics.push({ kind: "observe", name, value });
          },
        },
      },
    );
    expect(malwareResult).toBe("rejected_malware");

    const parserFailureMarker = "DOCLING_INTERNAL_ERROR_MARKER_2026";
    const parserFailure = await completeTusUpload({
      title: "Parser failure safety file",
      filename: "parser-failure-safety.txt",
      bytes: Buffer.from("parser failure safety bytes"),
      tusUploadId: "tus-parser-failure-safety",
    });
    const parserFailureResult = await processCompletedUpload(
      testDb.client.sql,
      parserFailure.intentId,
      {
        storage: parserFailure.storage,
        scanner: new FakeMalwareScanner({
          verdict: "clean",
          scannerVersion: "clamav-test",
          signatureDatabaseVersion: "db-test",
        }),
        metadataExtractor: new FakeMetadataExtractor({
          mediaTypeDetected: "text/plain",
          metadataText: tikaRaw,
          extractedText: rawText,
          processorVersion: "tika-test",
        }),
        richParser: new FakeRichDocumentParser({
          errorCode: parserFailureMarker,
        }),
        quarantineBucket: "safety-quarantine",
        readyBucket: "safety-ready",
        readyPrefix: "ready/",
        derivedPrefix: "derived/",
        maxExtractedSearchBytes: 4096,
        metrics: {
          increment(name: string) {
            metrics.push({ kind: "increment", name });
          },
          observe(name: string, value: number) {
            metrics.push({ kind: "observe", name, value });
          },
        },
      },
    );
    expect(parserFailureResult).toBe("ready_with_parse_error");

    const parserFailureRows = await testDb.client.sql.unsafe(
      `select status, error_code
       from file_processing_records
       where processor_name = 'docling'
       order by created_at desc
       limit 1`,
    );
    expect(parserFailureRows[0]).toMatchObject({
      status: "failed",
      error_code: "RICH_PARSE_FAILED",
    });
    expect(JSON.stringify(parserFailureRows)).not.toContain(parserFailureMarker);

    await registerExternalDataVersion(
      testDb.client.sql,
      projectId,
      {
        title: "Restricted safety data",
        fileKind: "dataset",
        accessClass: "restricted",
        uriOrLocator: restrictedLocator,
        manifestHash: "manifest-safety-hash",
        accessPolicyRef: "policy:safety",
        licenseOrAgreementRef: "agreement:safety",
        versionLabel: "release-safety",
      },
      actor,
    );

    await createFileLink(
      testDb.client.sql,
      {
        fileVersionId: cleanVersionId,
        subjectType: "project",
        subjectId: projectId,
        relation: "documents",
      },
      actor,
    );

    const [events, outbox, inbox] = await Promise.all([
      testDb.client.sql.unsafe(
        "select event_type, actor_type, actor_id, payload from research_events where project_id = $1 order by created_at, id",
        [projectId],
      ),
      testDb.client.sql.unsafe(
        "select event_type, payload from outbox_events order by created_at, id",
      ),
      testDb.client.sql.unsafe(
        "select provider, external_id, payload from integration_inbox where provider = 'tusd' order by received_at, id",
      ),
    ]);

    const forbidden = [
      signingSecret,
      clean.uploadToken,
      malware.uploadToken,
      rawText,
      tikaRaw,
      doclingRaw,
      clamInternal,
      parserFailureMarker,
      restrictedLocator,
    ];
    assertNoMarkerLeak(events, forbidden);
    assertNoMarkerLeak(outbox, forbidden);
    assertNoMarkerLeak(inbox, forbidden);
    assertNoMarkerLeak(metrics, forbidden);

    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric.name).toMatch(/^file\./);
      if (metric.value !== undefined) expect(Number.isFinite(metric.value)).toBe(true);
    }

    const afterScientific = await testDb.client.sql.unsafe(
      `select
         (select count(*)::int from scientific_decisions where project_id = $1) as decisions,
         (select count(*)::int from research_results where project_id = $1) as results`,
      [projectId],
    );
    expect(afterScientific[0]).toEqual(beforeScientific[0]);
  });
});
