import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimOutboxBatch,
  markOutboxDelivered,
  markOutboxFailed,
} from "../../packages/queue/src/outbox-dispatcher";
import { FakeObjectStorage } from "../../packages/storage/src/fake";
import {
  FakeMalwareScanner,
  FakeMetadataExtractor,
  FakeRichDocumentParser,
} from "../../packages/file-processing/src/fakes";
import { createFileOutboxHandler } from "../../apps/worker/src/file-worker";
import { composeOutboxHandlers } from "../../apps/worker/src/file-runtime";
import { runOutboxPass } from "../../apps/worker/src/outbox-worker";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("outbox retry after worker crash", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("reclaims an abandoned delivery and executes it once after restart", async () => {
    await testDb.client.sql.unsafe(
      "insert into outbox_events (id, event_type, payload) values ('retry-outbox', 'test.event', '{}'::jsonb)",
    );

    const firstClaim = await claimOutboxBatch(testDb.client.sql, 1);
    expect(firstClaim.map((row) => row.id)).toEqual(["retry-outbox"]);

    // Simulate a process crash after claim and before dispatch/ack.
    await testDb.client.sql.unsafe(
      "update outbox_events set claimed_at = now() - interval '2 minutes' where id = 'retry-outbox'",
    );

    const restartedClaim = await claimOutboxBatch(testDb.client.sql, 1);
    const deliveries: string[] = [];
    for (const record of restartedClaim) {
      deliveries.push(record.id);
      await markOutboxDelivered(testDb.client.sql, record.id);
    }

    expect(deliveries).toEqual(["retry-outbox"]);
    expect(await claimOutboxBatch(testDb.client.sql, 1)).toEqual([]);

    const rows = await testDb.client.sql.unsafe(
      "select status from outbox_events where id = 'retry-outbox'",
    );
    expect(rows[0]?.status).toBe("delivered");
  });

  it("does not let two workers claim the same pending row", async () => {
    await testDb.client.sql.unsafe(
      "insert into outbox_events (id, event_type, payload) values ('race-outbox', 'test.event', '{}'::jsonb)",
    );

    const [left, right] = await Promise.all([
      claimOutboxBatch(testDb.client.sql, 1),
      claimOutboxBatch(testDb.client.sql, 1),
    ]);

    expect([...left, ...right].filter((row) => row.id === "race-outbox")).toHaveLength(1);
  });

  it("retries a transient file scan failure and finalizes the upload exactly once", async () => {
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('retry-file-team', 'Retry File Team') on conflict do nothing",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ('retry-file-lead', 'retry-file-team', 'lead@retry-file.test',
               'Retry File Lead', 'lead', 'human')
       on conflict do nothing`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('retry-file-portfolio', 'retry-file-team', 'Retry Portfolio') on conflict do nothing",
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ('retry-file-project', 'retry-file-portfolio', 'Retry File Project', 'retry-file-lead')
       on conflict do nothing`,
    );

    const storage = new FakeObjectStorage();
    const bytes = Buffer.from("outbox-file-retry-content");
    await storage.putObject(
      { bucket: "retry-quarantine", key: "uploads/retry-file-intent" },
      bytes,
      "application/octet-stream",
    );
    await testDb.client.sql.unsafe(
      `insert into file_upload_intents
        (id, project_id, proposed_title, file_kind, access_class, original_filename,
         expected_byte_size, declared_media_type, state, tus_upload_id,
         quarantine_bucket, quarantine_key, created_by, expires_at)
       values ('retry-file-intent', 'retry-file-project', 'Retry paper', 'literature',
               'project', 'retry.pdf', $1, 'application/pdf', 'uploaded_quarantine',
               'tus-retry-file', 'retry-quarantine', 'uploads/retry-file-intent',
               'retry-file-lead', now() + interval '1 hour')`,
      [bytes.byteLength],
    );
    await testDb.client.sql.unsafe(
      `insert into outbox_events (id, event_type, payload)
       values (
         'retry-file-outbox',
         'file.upload.completed',
         '{"uploadIntentId":"retry-file-intent","tusUploadId":"tus-retry-file"}'::jsonb
       )`,
    );

    const baseDeps = {
      storage,
      metadataExtractor: new FakeMetadataExtractor({
        mediaTypeDetected: "application/pdf",
        metadataText: '{"Content-Type":"application/pdf"}',
        extractedText: "retry fallback text",
        processorVersion: "tika-retry-test",
      }),
      richParser: new FakeRichDocumentParser({
        supported: true,
        processorVersion: "docling-retry-test",
        artifacts: [{ kind: "markdown" as const, text: "# Retry" }],
      }),
      quarantineBucket: "retry-quarantine",
      readyBucket: "retry-ready",
      readyPrefix: "ready/",
      derivedPrefix: "derived/",
      maxExtractedSearchBytes: 4096,
      metrics: {
        increment(_name: string) {},
        observe(_name: string, _value: number) {},
      },
    };

    const failingDispatch = composeOutboxHandlers(
      createFileOutboxHandler(testDb.client.sql, {
        ...baseDeps,
        scanner: new FakeMalwareScanner({
          errorCode: "ECONNREFUSED private-clamav-secret-detail",
        }),
      }),
    );
    expect(await runOutboxPass(testDb.client.sql, failingDispatch, 1)).toBe(1);

    const failedRows = await testDb.client.sql.unsafe(
      `select status, last_error
       from outbox_events
       where id = 'retry-file-outbox'`,
    );
    expect(failedRows[0]).toMatchObject({
      status: "pending",
      last_error: "DispatchError",
    });
    expect(JSON.stringify(failedRows[0])).not.toContain("private-clamav-secret-detail");

    const failedIntent = await testDb.client.sql.unsafe(
      "select state from file_upload_intents where id = 'retry-file-intent'",
    );
    expect(failedIntent[0]?.state).toBe("processing_failed");

    await testDb.client.sql.unsafe(
      "update outbox_events set available_at = now() where id = 'retry-file-outbox'",
    );

    const cleanDispatch = composeOutboxHandlers(
      createFileOutboxHandler(testDb.client.sql, {
        ...baseDeps,
        scanner: new FakeMalwareScanner({
          verdict: "clean",
          scannerVersion: "clamav-retry-test",
          signatureDatabaseVersion: "db-retry-test",
        }),
      }),
    );
    expect(await runOutboxPass(testDb.client.sql, cleanDispatch, 1)).toBe(1);

    const deliveredRows = await testDb.client.sql.unsafe(
      "select status, last_error from outbox_events where id = 'retry-file-outbox'",
    );
    expect(deliveredRows[0]).toMatchObject({
      status: "delivered",
      last_error: null,
    });

    const versions = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = 'retry-file-project'`,
    );
    expect(versions[0]?.count).toBe(1);

    expect(await runOutboxPass(testDb.client.sql, cleanDispatch, 1)).toBe(0);
    const versionsAfterDuplicatePass = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where rf.project_id = 'retry-file-project'`,
    );
    expect(versionsAfterDuplicatePass[0]?.count).toBe(1);
  });

  it("does not persist arbitrary secret-bearing dispatch error text", async () => {
    await testDb.client.sql.unsafe(
      "insert into outbox_events (id, event_type, payload) values ('safe-error-outbox', 'test.event', '{}'::jsonb)",
    );

    await markOutboxFailed(
      testDb.client.sql,
      "safe-error-outbox",
      new Error("Authorization token=super-secret-token-value"),
    );

    const rows = await testDb.client.sql.unsafe(
      "select last_error from outbox_events where id = 'safe-error-outbox'",
    );
    expect(String(rows[0]?.last_error ?? "")).not.toContain("super-secret-token-value");
  });
});
