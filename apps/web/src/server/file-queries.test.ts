import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

vi.mock("server-only", () => ({}));

describe("file read models", () => {
  let testDb: TestDatabase;
  let queries: typeof import("./queries");

  const collaborator = {
    id: "file-query-collaborator",
    teamId: "file-query-team",
    displayName: "Collaborator",
    organizationRole: "researcher" as const,
  };
  const projectLead = {
    id: "file-query-project-lead",
    teamId: "file-query-team",
    displayName: "Project Lead",
    organizationRole: "researcher" as const,
  };
  const teamLead = {
    id: "file-query-team-lead",
    teamId: "file-query-team",
    displayName: "Team Lead",
    organizationRole: "lead" as const,
  };
  const externalCreator = {
    id: "file-query-creator",
    teamId: "file-query-team",
    displayName: "Reference Creator",
    organizationRole: "researcher" as const,
  };

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    process.env.DATABASE_URL = testDb.container.getConnectionUri();

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('file-query-team', 'File Query Team')",
    );
    for (const member of [
      ["file-query-team-lead", "teamlead@query.test", "Team Lead", "lead"],
      ["file-query-project-lead", "projectlead@query.test", "Project Lead", "researcher"],
      ["file-query-collaborator", "collaborator@query.test", "Collaborator", "researcher"],
      ["file-query-creator", "creator@query.test", "Reference Creator", "researcher"],
    ]) {
      await testDb.client.sql.unsafe(
        "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ($1, 'file-query-team', $2, $3, $4, 'human')",
        member,
      );
    }
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('file-query-portfolio', 'file-query-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('file-query-project', 'file-query-portfolio', 'Project', 'file-query-project-lead')",
    );
    for (const membership of [
      ["membership-lead", "file-query-project-lead", "lead"],
      ["membership-collaborator", "file-query-collaborator", "collaborator"],
      ["membership-creator", "file-query-creator", "collaborator"],
    ]) {
      await testDb.client.sql.unsafe(
        "insert into project_memberships (id, project_id, member_id, role) values ($1, 'file-query-project', $2, $3)",
        membership,
      );
    }

    await seedUploadedFile(testDb);
    await seedRestrictedExternalReference(testDb);

    queries = await import("./queries");
  }, 120_000);

  afterAll(async () => {
    if (queries) {
      await queries.getWebDbClient().close();
    }
    delete process.env.DATABASE_URL;
    if (testDb) await stopTestDatabase(testDb);
  });

  it("lists current version facts while preserving full detail history", async () => {
    const list = await queries.getProjectFiles(collaborator, "file-query-project");
    expect(list).not.toBeNull();
    const uploaded = list!.find((item) => item.id === "uploaded-file");
    expect(uploaded).toMatchObject({
      title: "Field survey materials",
      fileKind: "literature",
      currentVersionNumber: 2,
      accessClass: "project",
      lifecycleState: "active",
      scanStatus: "passed",
      parseStatus: "parsed",
      linkCount: 1,
    });

    const detail = await queries.getResearchFileDetail(collaborator, "uploaded-file");
    expect(detail).not.toBeNull();
    expect(detail!.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(detail!.versions[0]).toMatchObject({
      id: "uploaded-version-2",
      originalFilename: "survey-v2.pdf",
      sha256: "b".repeat(64),
      mediaType: "application/pdf",
    });
    expect(detail!.activeLinks).toHaveLength(1);
    expect(detail!.retiredLinks).toHaveLength(1);
  });

  it("uses PostgreSQL FTS and supports file kind, processing and subject filters", async () => {
    const byExtractedText = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { q: "latent trust" },
    );
    expect(byExtractedText?.map((item) => item.id)).toContain("uploaded-file");

    const byKind = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { fileKind: "dataset" },
    );
    expect(byKind?.map((item) => item.id)).toEqual(["restricted-file"]);

    const byProcessing = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { processingState: "parsed" },
    );
    expect(byProcessing?.map((item) => item.id)).toContain("uploaded-file");
    expect(byProcessing?.map((item) => item.id)).not.toContain("restricted-file");

    const bySubject = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { subjectType: "project" },
    );
    expect(bySubject?.map((item) => item.id)).toEqual(["uploaded-file"]);
  });

  it("redacts restricted locator metadata for ordinary members but not authorized principals", async () => {
    const ordinary = await queries.getResearchFileDetail(
      collaborator,
      "restricted-file",
    );
    expect(ordinary?.externalReference).toMatchObject({
      id: "restricted-reference",
      manifestHash: "manifest-sha-256",
      versionLabel: "release-2026-09",
      uriOrLocator: null,
      accessPolicyRef: null,
      licenseOrAgreementRef: null,
    });

    for (const member of [projectLead, teamLead, externalCreator]) {
      const detail = await queries.getResearchFileDetail(member, "restricted-file");
      expect(detail?.externalReference).toMatchObject({
        uriOrLocator: "secure-datalake://study-42/release-2026-09",
        accessPolicyRef: "policy:restricted-study-42",
        licenseOrAgreementRef: "agreement:duA-42",
      });
    }
  });

  it("normalizes empty, punctuation-only and injection-shaped search without SQL errors or metadata leakage", async () => {
    const all = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { q: "   " },
    );
    expect(all?.map((item) => item.id).sort()).toEqual([
      "restricted-file",
      "uploaded-file",
    ]);

    const punctuation = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { q: "!!! --- ???" },
    );
    expect(punctuation?.map((item) => item.id).sort()).toEqual([
      "restricted-file",
      "uploaded-file",
    ]);

    const injection = await queries.getProjectFiles(
      collaborator,
      "file-query-project",
      { q: "'; drop table research_files; --" },
    );
    expect(injection).not.toBeNull();

    const tableStillExists = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_files",
    );
    expect(tableStillExists[0]?.count).toBe(2);

    const searchRows = await testDb.client.sql.unsafe(
      "select extracted_text, metadata::text as metadata from file_search_documents",
    );
    expect(JSON.stringify(searchRows)).not.toContain(
      "secure-datalake://study-42/release-2026-09",
    );
    expect(JSON.stringify(searchRows)).not.toContain("rawParserPayload");
  });
});

async function seedUploadedFile(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql.unsafe(
    `insert into research_files
      (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
     values ('uploaded-file', 'file-query-project', 'Field survey materials',
             'literature', 'project', 'active', 'file-query-project-lead')`,
  );
  await testDb.client.sql.unsafe(
    `insert into file_blobs
      (id, sha256, storage_backend, storage_key, byte_size, media_type_detected, quarantine_state)
     values
      ('uploaded-blob-1', $1, 's3', 'ready/a/version-1', 10, 'application/pdf', 'ready'),
      ('uploaded-blob-2', $2, 's3', 'ready/b/version-2', 20, 'application/pdf', 'ready')`,
    ["a".repeat(64), "b".repeat(64)],
  );
  await testDb.client.sql.unsafe(
    `insert into file_versions
      (id, research_file_id, version_number, blob_id, original_filename, media_type,
       byte_size, sha256, source_kind, scan_status, parse_status, created_by, created_at)
     values
      ('uploaded-version-1', 'uploaded-file', 1, 'uploaded-blob-1', 'survey-v1.pdf',
       'application/pdf', 10, $1, 'upload', 'passed', 'parsed',
       'file-query-project-lead', now() - interval '1 day'),
      ('uploaded-version-2', 'uploaded-file', 2, 'uploaded-blob-2', 'survey-v2.pdf',
       'application/pdf', 20, $2, 'upload', 'passed', 'parsed',
       'file-query-project-lead', now())`,
    ["a".repeat(64), "b".repeat(64)],
  );
  await testDb.client.sql.unsafe(
    "update research_files set current_version_id = 'uploaded-version-2' where id = 'uploaded-file'",
  );
  await testDb.client.sql.unsafe(
    `insert into file_processing_records
      (id, file_version_id, processor_kind, processor_name, processor_version,
       status, input_hash, output_refs, started_at, finished_at)
     values
      ('uploaded-processing-1', 'uploaded-version-1', 'rich_parser', 'docling', '1',
       'succeeded', $1, '["storage:derived/v1"]'::jsonb, now(), now()),
      ('uploaded-processing-2', 'uploaded-version-2', 'rich_parser', 'docling', '2',
       'succeeded', $2, '["storage:derived/v2"]'::jsonb, now(), now())`,
    ["a".repeat(64), "b".repeat(64)],
  );
  await testDb.client.sql.unsafe(
    `insert into file_search_documents
      (file_version_id, research_file_id, project_id, title, original_filename,
       extracted_text, metadata, search_vector)
     values
      ('uploaded-version-1', 'uploaded-file', 'file-query-project',
       'Field survey materials', 'survey-v1.pdf', 'old field notes',
       '{"mediaTypeDetected":"application/pdf"}'::jsonb,
       to_tsvector('simple', 'old field notes')),
      ('uploaded-version-2', 'uploaded-file', 'file-query-project',
       'Field survey materials', 'survey-v2.pdf',
       'latent trust patterns from interviews',
       '{"mediaTypeDetected":"application/pdf"}'::jsonb,
       to_tsvector('simple', 'Field survey materials survey-v2.pdf latent trust patterns from interviews'))`,
  );
  await testDb.client.sql.unsafe(
    `insert into file_links
      (id, file_version_id, subject_type, subject_id, relation, created_by_type, created_by_id)
     values
      ('active-project-link', 'uploaded-version-2', 'project', 'file-query-project',
       'documents', 'human', 'file-query-project-lead'),
      ('retired-project-link', 'uploaded-version-1', 'project', 'file-query-project',
       'source_for', 'human', 'file-query-project-lead')`,
  );
  await testDb.client.sql.unsafe(
    `insert into file_link_retirements
      (id, file_link_id, reason, created_by_type, created_by_id)
     values ('retired-project-link-record', 'retired-project-link',
             'superseded by v2', 'human', 'file-query-project-lead')`,
  );
}

async function seedRestrictedExternalReference(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql.unsafe(
    `insert into research_files
      (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
     values ('restricted-file', 'file-query-project', 'Restricted panel dataset',
             'dataset', 'restricted', 'active', 'file-query-creator')`,
  );
  await testDb.client.sql.unsafe(
    `insert into external_data_references
      (id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
       license_or_agreement_ref, version_label, created_by)
     values ('restricted-reference', 'file-query-project',
             'secure-datalake://study-42/release-2026-09',
             'manifest-sha-256', 'policy:restricted-study-42',
             'agreement:duA-42', 'release-2026-09', 'file-query-creator')`,
  );
  await testDb.client.sql.unsafe(
    `insert into file_versions
      (id, research_file_id, version_number, external_reference_id, original_filename,
       source_kind, scan_status, parse_status, created_by)
     values ('restricted-version-1', 'restricted-file', 1, 'restricted-reference',
             'external-dataset-reference', 'external_reference',
             'not_applicable', 'not_applicable', 'file-query-creator')`,
  );
  await testDb.client.sql.unsafe(
    "update research_files set current_version_id = 'restricted-version-1' where id = 'restricted-file'",
  );
}
