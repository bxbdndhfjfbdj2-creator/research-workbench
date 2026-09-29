import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("research file service", () => {
  let testDb: TestDatabase;
  let service: typeof import("./file-service");

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('svc-team', 'Service Team')");
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('svc-lead', 'svc-team', 'lead@svc.test', 'Lead', 'lead', 'human'), ('svc-project-lead', 'svc-team', 'project@svc.test', 'Project Lead', 'researcher', 'human'), ('svc-collab', 'svc-team', 'collab@svc.test', 'Collaborator', 'researcher', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('svc-portfolio', 'svc-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('svc-project', 'svc-portfolio', 'Project', 'svc-project-lead')",
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('svc-project-membership', 'svc-project', 'svc-project-lead', 'lead'), ('svc-collab-membership', 'svc-project', 'svc-collab', 'collaborator')",
    );
    const modulePath = "./file-service";
    service = await import(modulePath);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("creates a logical research file with an auditable event and outbox fact", async () => {
    const file = await service.createResearchFile(
      testDb.client.sql,
      "svc-project",
      {
        title: "Interview protocol",
        fileKind: "research_design",
        accessClass: "project",
        description: "Protocol for wave one",
      },
      { type: "human", id: "svc-collab" },
    );

    expect(file).toMatchObject({
      projectId: "svc-project",
      title: "Interview protocol",
      fileKind: "research_design",
      accessClass: "project",
      currentVersionId: null,
      lifecycleState: "draft",
      createdBy: "svc-collab",
    });

    const events = await testDb.client.sql.unsafe(
      "select event_type, payload from research_events where project_id = 'svc-project' and event_type = 'RESEARCH_FILE_CREATED' order by created_at desc",
    );
    expect(events[0]?.payload).toMatchObject({ researchFileId: file.id, fileKind: "research_design" });

    const outbox = await testDb.client.sql.unsafe(
      "select event_type, payload from outbox_events where event_type = 'research.file.created' order by created_at desc",
    );
    expect(outbox[0]?.payload).toMatchObject({ projectId: "svc-project", researchFileId: file.id });
  });

  it("registers restricted external data without copying bytes and advances current version atomically", async () => {
    const result = await service.registerExternalDataVersion(
      testDb.client.sql,
      "svc-project",
      {
        title: "Restricted panel dataset",
        fileKind: "dataset",
        accessClass: "restricted",
        uriOrLocator: "catalog:restricted-panel:v1",
        manifestHash: "manifest-sha256:abc123",
        accessPolicyRef: "policy:restricted-panel",
        licenseOrAgreementRef: "agreement:duA-42",
        versionLabel: "2026Q3",
      },
      { type: "human", id: "svc-project-lead" },
    );

    expect(result.researchFile.currentVersionId).toBe(result.fileVersion.id);
    expect(result.fileVersion).toMatchObject({
      versionNumber: 1,
      sourceKind: "external_reference",
      blobId: null,
      scanStatus: "not_applicable",
      parseStatus: "not_applicable",
    });
    expect(result.externalReference).toMatchObject({
      uriOrLocator: "catalog:restricted-panel:v1",
      versionLabel: "2026Q3",
    });

    const versionRows = await testDb.client.sql.unsafe(
      "select blob_id, external_reference_id, scan_status, parse_status from file_versions where id = $1",
      [result.fileVersion.id],
    );
    expect(versionRows[0]).toMatchObject({
      blob_id: null,
      external_reference_id: result.externalReference.id,
      scan_status: "not_applicable",
      parse_status: "not_applicable",
    });

    const eventRows = await testDb.client.sql.unsafe(
      "select event_type, payload from research_events where project_id = 'svc-project' and event_type in ('EXTERNAL_DATA_REFERENCE_CREATED', 'FILE_VERSION_CREATED') order by created_at",
    );
    expect(eventRows.map((row) => row.event_type)).toEqual([
      "EXTERNAL_DATA_REFERENCE_CREATED",
      "FILE_VERSION_CREATED",
    ]);
    expect(JSON.stringify(eventRows)).not.toContain("catalog:restricted-panel:v1");
  });

  it("allocates a new immutable external version under the existing logical file", async () => {
    const first = await service.registerExternalDataVersion(
      testDb.client.sql,
      "svc-project",
      {
        title: "Codebook",
        fileKind: "data_documentation",
        accessClass: "project",
        uriOrLocator: "catalog:codebook:v1",
        manifestHash: "manifest:v1",
        accessPolicyRef: "policy:team",
        versionLabel: "v1",
      },
      { type: "human", id: "svc-project-lead" },
    );

    const second = await service.registerExternalDataVersion(
      testDb.client.sql,
      "svc-project",
      {
        researchFileId: first.researchFile.id,
        fileKind: "data_documentation",
        accessClass: "project",
        uriOrLocator: "catalog:codebook:v2",
        manifestHash: "manifest:v2",
        accessPolicyRef: "policy:team",
        versionLabel: "v2",
        changeSummary: "Adds wave-two variables",
      },
      { type: "human", id: "svc-project-lead" },
    );

    expect(second.fileVersion.versionNumber).toBe(2);
    expect(second.researchFile.currentVersionId).toBe(second.fileVersion.id);
    const rows = await testDb.client.sql.unsafe(
      "select version_number from file_versions where research_file_id = $1 order by version_number",
      [first.researchFile.id],
    );
    expect(rows.map((row) => Number(row.version_number))).toEqual([1, 2]);
  });

  it("rejects credential-bearing locators before writing facts", async () => {
    const before = await countFacts(testDb);
    await expect(
      service.registerExternalDataVersion(
        testDb.client.sql,
        "svc-project",
        {
          title: "Bad locator",
          fileKind: "dataset",
          accessClass: "restricted",
          uriOrLocator: "https://user:password@example.test/data",
          manifestHash: "manifest:bad",
          accessPolicyRef: "policy:restricted",
          versionLabel: "v1",
        },
        { type: "human", id: "svc-project-lead" },
      ),
    ).rejects.toThrow(/credential/i);
    expect(await countFacts(testDb)).toEqual(before);
  });

  it("rejects raw bytes on the external-reference API", async () => {
    const before = await countFacts(testDb);
    await expect(
      service.registerExternalDataVersion(
        testDb.client.sql,
        "svc-project",
        {
          title: "Raw data",
          fileKind: "dataset",
          accessClass: "restricted",
          uriOrLocator: "catalog:raw:v1",
          manifestHash: "manifest:raw",
          accessPolicyRef: "policy:restricted",
          versionLabel: "v1",
          rawBytes: new Uint8Array([1, 2, 3]),
        } as never,
        { type: "human", id: "svc-project-lead" },
      ),
    ).rejects.toThrow(/raw bytes/i);
    expect(await countFacts(testDb)).toEqual(before);
  });
});

async function countFacts(testDb: TestDatabase): Promise<Record<string, number>> {
  const rows = await Promise.all([
    testDb.client.sql.unsafe("select count(*)::int as count from research_files"),
    testDb.client.sql.unsafe("select count(*)::int as count from external_data_references"),
    testDb.client.sql.unsafe("select count(*)::int as count from file_versions"),
    testDb.client.sql.unsafe("select count(*)::int as count from research_events"),
  ]);
  return {
    files: Number(rows[0][0]?.count ?? 0),
    refs: Number(rows[1][0]?.count ?? 0),
    versions: Number(rows[2][0]?.count ?? 0),
    events: Number(rows[3][0]?.count ?? 0),
  };
}
