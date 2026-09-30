import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("file content authorization", () => {
  let testDb: TestDatabase;
  let contentAccess: typeof import("./content-access");

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('content-team', 'Content Team'), ('outsider-team', 'Outsider Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values
        ('content-lead', 'content-team', 'lead@content.test', 'Lead', 'lead', 'human'),
        ('content-reader', 'content-team', 'reader@content.test', 'Reader', 'researcher', 'human'),
        ('content-outsider', 'outsider-team', 'outsider@content.test', 'Outsider', 'lead', 'human')`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('content-portfolio', 'content-team', 'Content Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('content-project', 'content-portfolio', 'Content Project', 'content-lead')",
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('content-reader-membership', 'content-project', 'content-reader', 'observer')",
    );

    await testDb.client.sql.unsafe(
      `insert into research_files
        (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
       values
        ('content-file', 'content-project', 'Ready paper', 'literature', 'project', 'active', 'content-lead'),
        ('restricted-content-file', 'content-project', 'Restricted paper', 'literature', 'restricted', 'active', 'content-lead'),
        ('external-content-file', 'content-project', 'External dataset', 'dataset', 'restricted', 'active', 'content-lead')`,
    );
    await testDb.client.sql.unsafe(
      `insert into file_blobs
        (id, sha256, storage_backend, storage_key, byte_size, media_type_detected, quarantine_state)
       values
        ('content-blob', repeat('a', 64), 's3', 'ready/aa/content-file', 1234, 'application/pdf', 'ready'),
        ('restricted-content-blob', repeat('b', 64), 's3', 'ready/bb/restricted-file', 321, 'application/pdf', 'ready')`,
    );
    await testDb.client.sql.unsafe(
      `insert into external_data_references
        (id, project_id, uri_or_locator, manifest_hash, access_policy_ref, version_label, created_by)
       values ('external-content-ref', 'content-project', 'catalog:restricted-dataset:v1',
               repeat('c', 64), 'policy:restricted', 'v1', 'content-lead')`,
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, blob_id, original_filename, media_type,
         byte_size, sha256, source_kind, scan_status, parse_status, created_by)
       values
        ('content-version', 'content-file', 1, 'content-blob', 'paper.pdf', 'application/pdf',
         1234, repeat('a', 64), 'upload', 'passed', 'parsed', 'content-lead'),
        ('restricted-content-version', 'restricted-content-file', 1, 'restricted-content-blob',
         'restricted.pdf', 'application/pdf', 321, repeat('b', 64), 'upload', 'passed',
         'parsed', 'content-lead')`,
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, external_reference_id, original_filename,
         source_kind, scan_status, parse_status, created_by)
       values ('external-content-version', 'external-content-file', 1,
               'external-content-ref', 'external-dataset', 'external_reference',
               'not_applicable', 'not_applicable', 'content-lead')`,
    );
    await testDb.client.sql.unsafe(
      `update research_files
       set current_version_id = case id
         when 'content-file' then 'content-version'
         when 'restricted-content-file' then 'restricted-content-version'
         when 'external-content-file' then 'external-content-version'
       end
       where id in ('content-file', 'restricted-content-file', 'external-content-file')`,
    );
    await testDb.client.sql.unsafe(
      `insert into file_upload_intents
        (id, project_id, proposed_title, file_kind, access_class, original_filename,
         expected_byte_size, state, created_by, expires_at)
       values ('pending-content-upload', 'content-project', 'Pending', 'literature', 'project',
               'pending.pdf', 100, 'uploading', 'content-lead', now() + interval '1 hour')`,
    );

    const modulePath = "./content-access";
    contentAccess = await import(modulePath);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("returns a logical ready storage reference for an authorized project member", async () => {
    const descriptor = await contentAccess.getFileContentDescriptor(
      testDb.client.sql,
      "content-version",
      "content-reader",
    );

    expect(descriptor).toEqual({
      projectId: "content-project",
      originalFilename: "paper.pdf",
      mediaType: "application/pdf",
      byteSize: 1234,
      storageRef: {
        bucket: "ready",
        key: "ready/aa/content-file",
      },
      accessClass: "project",
    });
  });

  it("does not let a different team or project bypass content authorization", async () => {
    await expect(
      contentAccess.getFileContentDescriptor(
        testDb.client.sql,
        "content-version",
        "content-outsider",
      ),
    ).rejects.toThrow(/forbidden/i);

    await expect(
      contentAccess.getFileContentDescriptor(
        testDb.client.sql,
        "restricted-content-version",
        "content-outsider",
      ),
    ).rejects.toThrow(/forbidden/i);
  });

  it("allows project membership to read a restricted uploaded file without weakening project membership", async () => {
    const descriptor = await contentAccess.getFileContentDescriptor(
      testDb.client.sql,
      "restricted-content-version",
      "content-reader",
    );
    expect(descriptor).toMatchObject({
      projectId: "content-project",
      accessClass: "restricted",
      storageRef: { bucket: "ready", key: "ready/bb/restricted-file" },
    });
  });

  it("refuses external-reference, pending, rejected, or unknown content identities", async () => {
    await expect(
      contentAccess.getFileContentDescriptor(
        testDb.client.sql,
        "external-content-version",
        "content-reader",
      ),
    ).rejects.toThrow(/content|blob|external/i);

    await expect(
      contentAccess.getFileContentDescriptor(
        testDb.client.sql,
        "pending-content-upload",
        "content-reader",
      ),
    ).rejects.toThrow(/not found|version/i);

    await expect(
      contentAccess.getFileContentDescriptor(
        testDb.client.sql,
        "rejected-malware-version-that-does-not-exist",
        "content-reader",
      ),
    ).rejects.toThrow(/not found|version/i);
  });
});
