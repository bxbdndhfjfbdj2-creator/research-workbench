import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("files provenance database model", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('files-team', 'Files Team')");
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('files-lead', 'files-team', 'lead@files.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('files-portfolio', 'files-team', 'Files Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('files-project', 'files-portfolio', 'Files Project', 'files-lead')",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("applies the phase 4A migration", async () => {
    const rows = await testDb.client.sql.unsafe(
      "select to_regclass('public.research_files') as research_files, to_regclass('public.file_versions') as file_versions, to_regclass('public.file_upload_intents') as file_upload_intents",
    );
    expect(rows[0]).toMatchObject({
      research_files: "research_files",
      file_versions: "file_versions",
      file_upload_intents: "file_upload_intents",
    });
  });

  it("rejects file version updates and deletes", async () => {
    await seedUploadedVersion(testDb);
    await expect(
      testDb.client.sql.unsafe("update file_versions set original_filename = 'changed.pdf' where id = 'file-version-1'"),
    ).rejects.toThrow(/immutable|append-only/i);
    await expect(
      testDb.client.sql.unsafe("delete from file_versions where id = 'file-version-1'"),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("enforces version identity and backing-source constraints", async () => {
    await seedUploadedVersion(testDb);

    await expect(
      testDb.client.sql.unsafe(
        "insert into file_versions (id, research_file_id, version_number, blob_id, original_filename, media_type, byte_size, sha256, source_kind, scan_status, parse_status, created_by) values ('duplicate-version', 'research-file-1', 1, 'blob-1', 'dup.pdf', 'application/pdf', 3, repeat('a', 64), 'upload', 'passed', 'parsed', 'files-lead')",
      ),
    ).rejects.toThrow();

    await expect(
      testDb.client.sql.unsafe(
        "insert into file_versions (id, research_file_id, version_number, blob_id, external_reference_id, original_filename, source_kind, scan_status, parse_status, created_by) values ('both-backed', 'research-file-1', 2, 'blob-1', 'external-1', 'bad', 'upload', 'passed', 'parsed', 'files-lead')",
      ),
    ).rejects.toThrow();
  });

  it("requires currentVersionId to belong to the same research file", async () => {
    await seedUploadedVersion(testDb);
    await testDb.client.sql.unsafe(
      "insert into research_files (id, project_id, title, file_kind, access_class, lifecycle_state, created_by) values ('research-file-2', 'files-project', 'Other', 'literature', 'project', 'active', 'files-lead')",
    );
    await expect(
      testDb.client.sql.unsafe(
        "update research_files set current_version_id = 'file-version-1' where id = 'research-file-2'",
      ),
    ).rejects.toThrow(/current|version|same/i);
  });

  it("requires processor success to reference output artifacts", async () => {
    await seedUploadedVersion(testDb);
    await expect(
      testDb.client.sql.unsafe(
        "insert into file_processing_records (id, file_version_id, processor_kind, processor_name, processor_version, status, input_hash, output_refs) values ('processing-1', 'file-version-1', 'parser', 'docling', '1', 'succeeded', repeat('a', 64), '[]'::jsonb)",
      ),
    ).rejects.toThrow();
  });

  it("keeps links and external references append-only", async () => {
    await seedUploadedVersion(testDb);
    await testDb.client.sql.unsafe(
      "insert into external_data_references (id, project_id, uri_or_locator, manifest_hash, access_policy_ref, version_label, created_by) values ('external-1', 'files-project', 'catalog:dataset:v1', repeat('b', 64), 'policy:restricted', 'v1', 'files-lead')",
    );
    await testDb.client.sql.unsafe(
      "insert into file_links (id, file_version_id, subject_type, subject_id, relation, created_by_type, created_by_id) values ('link-1', 'file-version-1', 'project', 'files-project', 'documents', 'human', 'files-lead')",
    );

    await expect(
      testDb.client.sql.unsafe("delete from file_links where id = 'link-1'"),
    ).rejects.toThrow(/append-only|immutable/i);
    await expect(
      testDb.client.sql.unsafe("update external_data_references set version_label = 'v2' where id = 'external-1'"),
    ).rejects.toThrow(/append-only|immutable/i);
  });
});

async function seedUploadedVersion(testDb: TestDatabase): Promise<void> {
  const existing = await testDb.client.sql.unsafe(
    "select 1 from file_versions where id = 'file-version-1'",
  );
  if (existing.length > 0) return;

  await testDb.client.sql.unsafe(
    "insert into research_files (id, project_id, title, file_kind, access_class, lifecycle_state, created_by) values ('research-file-1', 'files-project', 'Paper', 'literature', 'project', 'active', 'files-lead')",
  );
  await testDb.client.sql.unsafe(
    "insert into file_blobs (id, sha256, storage_backend, storage_key, byte_size, media_type_detected, quarantine_state) values ('blob-1', repeat('a', 64), 's3', 'ready/aa/file', 3, 'application/pdf', 'ready')",
  );
  await testDb.client.sql.unsafe(
    "insert into file_versions (id, research_file_id, version_number, blob_id, original_filename, media_type, byte_size, sha256, source_kind, scan_status, parse_status, created_by) values ('file-version-1', 'research-file-1', 1, 'blob-1', 'paper.pdf', 'application/pdf', 3, repeat('a', 64), 'upload', 'passed', 'parsed', 'files-lead')",
  );
  await testDb.client.sql.unsafe(
    "update research_files set current_version_id = 'file-version-1' where id = 'research-file-1'",
  );
}
