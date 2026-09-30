import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { registerExternalDataVersion } from "./file-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("file links", () => {
  let testDb: TestDatabase;
  let links: typeof import("./file-links");
  let fileVersionId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await seedProject(testDb);
    const registered = await registerExternalDataVersion(
      testDb.client.sql,
      "link-project",
      {
        title: "Evidence bundle",
        fileKind: "literature",
        accessClass: "project",
        uriOrLocator: "catalog:evidence:v1",
        manifestHash: "manifest:evidence:v1",
        accessPolicyRef: "policy:team",
        versionLabel: "v1",
      },
      { type: "human", id: "link-lead" },
    );
    fileVersionId = registered.fileVersion.id;
    const modulePath = "./file-links";
    links = await import(modulePath);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it.each([
    ["project", "link-project", "documents"],
    ["research_task", "link-task", "input_to"],
    ["research_node_revision", "link-revision", "supports"],
    ["research_result", "link-result", "source_for"],
    ["scientific_decision", "link-decision", "review_material"],
    ["data_version", "data:link:v1", "input_to"],
  ] as const)("links %s subjects only when they resolve to the same project", async (subjectType, subjectId, relation) => {
    const link = await links.createFileLink(
      testDb.client.sql,
      { fileVersionId, subjectType, subjectId, relation },
      { type: "human", id: "link-lead" },
    );

    expect(link).toMatchObject({ fileVersionId, subjectType, subjectId, relation });
  });

  it("rejects cross-project subjects even inside the same team", async () => {
    await expect(
      links.createFileLink(
        testDb.client.sql,
        {
          fileVersionId,
          subjectType: "research_task",
          subjectId: "other-task",
          relation: "input_to",
        },
        { type: "human", id: "link-lead" },
      ),
    ).rejects.toThrow(/project/i);
  });

  it("creates an auditable link fact without mutating the file version", async () => {
    const before = await testDb.client.sql.unsafe(
      "select research_file_id, version_number, external_reference_id from file_versions where id = $1",
      [fileVersionId],
    );
    const link = await links.createFileLink(
      testDb.client.sql,
      {
        fileVersionId,
        subjectType: "project",
        subjectId: "link-project",
        relation: "documents",
      },
      { type: "human", id: "link-lead" },
    );
    const after = await testDb.client.sql.unsafe(
      "select research_file_id, version_number, external_reference_id from file_versions where id = $1",
      [fileVersionId],
    );
    expect(after).toEqual(before);

    const events = await testDb.client.sql.unsafe(
      "select event_type, payload from research_events where event_type = 'FILE_LINK_CREATED' and payload ->> 'fileLinkId' = $1",
      [link.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      fileLinkId: link.id,
      fileVersionId,
      subjectType: "project",
      subjectId: "link-project",
      relation: "documents",
    });
  });

  it("retires a link append-only and makes duplicate retirement idempotent", async () => {
    const link = await links.createFileLink(
      testDb.client.sql,
      {
        fileVersionId,
        subjectType: "project",
        subjectId: "link-project",
        relation: "documents",
      },
      { type: "human", id: "link-lead" },
    );

    const first = await links.retireFileLink(
      testDb.client.sql,
      link.id,
      "Superseded by a newer relationship",
      { type: "human", id: "link-lead" },
    );
    const second = await links.retireFileLink(
      testDb.client.sql,
      link.id,
      "Superseded by a newer relationship",
      { type: "human", id: "link-lead" },
    );

    expect(second.id).toBe(first.id);
    const linkRows = await testDb.client.sql.unsafe("select * from file_links where id = $1", [link.id]);
    const retirements = await testDb.client.sql.unsafe(
      "select * from file_link_retirements where file_link_id = $1",
      [link.id],
    );
    expect(linkRows).toHaveLength(1);
    expect(retirements).toHaveLength(1);

    const events = await testDb.client.sql.unsafe(
      "select * from research_events where event_type = 'FILE_LINK_RETIRED' and payload ->> 'fileLinkId' = $1",
      [link.id],
    );
    expect(events).toHaveLength(1);
  });
});

async function seedProject(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql.unsafe("insert into teams (id, name) values ('link-team', 'Link Team')");
  await testDb.client.sql.unsafe(
    "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('link-lead', 'link-team', 'lead@link.test', 'Lead', 'lead', 'human')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_portfolios (id, team_id, name) values ('link-portfolio', 'link-team', 'Portfolio')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('link-project', 'link-portfolio', 'Project', 'link-lead'), ('other-project', 'link-portfolio', 'Other Project', 'link-lead')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_tasks (id, project_id, title, status, assignee_member_id, created_by) values ('link-task', 'link-project', 'Task', 'open', 'link-lead', 'link-lead'), ('other-task', 'other-project', 'Other Task', 'open', 'link-lead', 'link-lead')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_nodes (id, project_id, type, title) values ('link-node', 'link-project', 'analysis', 'Analysis')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_node_revisions (id, node_id, revision_number, content, status, created_by_type, created_by_id) values ('link-revision', 'link-node', 1, '{}'::jsonb, '候选', 'human', 'link-lead')",
  );
  await testDb.client.sql.unsafe(
    "insert into research_results (id, project_id, data_version_ref, analysis_revision_id, execution_kind, run_ref, output_refs, created_by_type, created_by_id) values ('link-result', 'link-project', 'data:link:v1', 'link-revision', 'manual', 'manual-link-run', '[]'::jsonb, 'human', 'link-lead')",
  );
  await testDb.client.sql.unsafe(
    "insert into scientific_decisions (id, project_id, level, title, reason, evidence, impact, change_kind, status, proposed_by_type, proposed_by_id) values ('link-decision', 'link-project', 'general', 'Decision', 'Review material', '[]'::jsonb, '[]'::jsonb, 'record_only', 'proposed', 'human', 'link-lead')",
  );
}
