import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("file upload intents", () => {
  let testDb: TestDatabase;
  let uploads: typeof import("./upload-intent");

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('upload-team', 'Upload Team')");
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('upload-lead', 'upload-team', 'lead@upload.test', 'Lead', 'lead', 'human'), ('upload-collab', 'upload-team', 'collab@upload.test', 'Collaborator', 'researcher', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('upload-portfolio', 'upload-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('upload-project', 'upload-portfolio', 'Project', 'upload-lead')",
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('upload-collab-membership', 'upload-project', 'upload-collab', 'collaborator')",
    );
    const modulePath = "./upload-intent";
    uploads = await import(modulePath);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("issues an HMAC-authenticated token bound to intent, actor, size and expiry", async () => {
    const secret = "phase4a-upload-secret";
    const created = await uploads.createFileUploadIntent(
      testDb.client.sql,
      "upload-project",
      {
        title: "Field notes",
        fileKind: "meeting_note",
        accessClass: "project",
        originalFilename: "../../field notes.txt",
        byteSize: 42,
        declaredMediaType: "text/plain",
      },
      { type: "human", id: "upload-collab" },
      secret,
      900,
      1_000,
    );

    const claims = uploads.verifyFileUploadToken(created.uploadToken, secret, created.expiresAt.getTime() - 1);
    expect(claims).toMatchObject({
      uploadIntentId: created.uploadIntentId,
      actorId: "upload-collab",
      expectedByteSize: 42,
    });
    expect(claims.expiresAt).toBe(created.expiresAt.getTime());

    const rows = await testDb.client.sql.unsafe(
      "select original_filename, quarantine_key from file_upload_intents where id = $1",
      [created.uploadIntentId],
    );
    expect(rows[0]).toMatchObject({
      original_filename: "../../field notes.txt",
      quarantine_key: null,
    });
  });

  it("rejects token tampering and expiry", async () => {
    const secret = "phase4a-upload-secret";
    const created = await uploads.createFileUploadIntent(
      testDb.client.sql,
      "upload-project",
      {
        title: "Protocol",
        fileKind: "research_design",
        accessClass: "project",
        originalFilename: "protocol.pdf",
        byteSize: 50,
      },
      { type: "human", id: "upload-lead" },
      secret,
      60,
      1_000,
    );

    const replacement = created.uploadToken.endsWith("a") ? "b" : "a";
    const tampered = created.uploadToken.slice(0, -1) + replacement;
    expect(() => uploads.verifyFileUploadToken(tampered, secret, Date.now())).toThrow(/signature|token/i);
    expect(() =>
      uploads.verifyFileUploadToken(created.uploadToken, secret, created.expiresAt.getTime() + 1),
    ).toThrow(/expired/i);
  });

  it("never stores the bearer token in upload facts, research events or outbox", async () => {
    const secret = "phase4a-upload-secret-never-store";
    const created = await uploads.createFileUploadIntent(
      testDb.client.sql,
      "upload-project",
      {
        title: "Interview guide",
        fileKind: "research_design",
        accessClass: "project",
        originalFilename: "guide.docx",
        byteSize: 100,
      },
      { type: "human", id: "upload-collab" },
      secret,
      600,
      1_000,
    );

    const intentRows = await testDb.client.sql.unsafe(
      "select row_to_json(file_upload_intents)::text as encoded from file_upload_intents where id = $1",
      [created.uploadIntentId],
    );
    const eventRows = await testDb.client.sql.unsafe(
      "select coalesce(jsonb_agg(payload), '[]'::jsonb)::text as encoded from research_events",
    );
    const outboxRows = await testDb.client.sql.unsafe(
      "select coalesce(jsonb_agg(payload), '[]'::jsonb)::text as encoded from outbox_events",
    );

    expect(String(intentRows[0]?.encoded)).not.toContain(created.uploadToken);
    expect(String(eventRows[0]?.encoded)).not.toContain(created.uploadToken);
    expect(String(outboxRows[0]?.encoded)).not.toContain(created.uploadToken);
  });

  it("enforces upload size and requires a change summary for an existing file version", async () => {
    await expect(
      uploads.createFileUploadIntent(
        testDb.client.sql,
        "upload-project",
        {
          title: "Too large",
          fileKind: "literature",
          accessClass: "project",
          originalFilename: "large.pdf",
          byteSize: 1_001,
        },
        { type: "human", id: "upload-lead" },
        "size-secret",
        600,
        1_000,
      ),
    ).rejects.toThrow(/size|large/i);

    await testDb.client.sql.unsafe(
      "insert into research_files (id, project_id, title, file_kind, access_class, lifecycle_state, created_by) values ('existing-upload-file', 'upload-project', 'Paper', 'literature', 'project', 'active', 'upload-lead')",
    );

    await expect(
      uploads.createFileUploadIntent(
        testDb.client.sql,
        "upload-project",
        {
          researchFileId: "existing-upload-file",
          fileKind: "literature",
          accessClass: "project",
          originalFilename: "paper-v2.pdf",
          byteSize: 200,
        },
        { type: "human", id: "upload-lead" },
        "version-secret",
        600,
        1_000,
      ),
    ).rejects.toThrow(/change summary/i);
  });
});
