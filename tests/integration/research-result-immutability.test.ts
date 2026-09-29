import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { createResearchNode, createNodeRevision } from "../../packages/application/src/research-graph/node-service";
import {
  createResearchResult,
  supersedeResearchResult,
} from "../../packages/application/src/results/create-result";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("immutable research results", () => {
  let testDb: TestDatabase;
  const projectId = "result-project";
  const leadId = "result-lead";
  let analysisRevisionId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('result-team', 'Result Team')");
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ($1, 'result-team', 'lead@result.test', 'Result Lead', 'lead', 'human')`,
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('result-portfolio', 'result-team', 'Result Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'result-portfolio', 'Result Project', $2)",
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('result-membership', $1, $2, 'lead')",
      [projectId, leadId],
    );
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "分析方案",
      "主分析方案",
      { type: "human", id: leadId },
    );
    const revision = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { model: "Y ~ X + FE" },
      "候选",
      { type: "human", id: leadId },
    );
    analysisRevisionId = revision.id;
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("rejects code results without an immutable Git commit locator", async () => {
    await expect(
      createResearchResult(
        testDb.client.sql,
        {
          projectId,
          dataVersionRef: "data:v1",
          analysisRevisionId,
          executionKind: "code",
          runRef: "manual-run-1",
          outputRefs: ["table:main"],
        },
        { type: "human", id: leadId },
      ),
    ).rejects.toThrow(/git|commit|代码/i);
  });

  it("rejects direct update and delete of a created result", async () => {
    const result = await createResearchResult(
      testDb.client.sql,
      {
        projectId,
        dataVersionRef: "data:v1",
        analysisRevisionId,
        executionKind: "code",
        runRef: "manual-run-2",
        outputRefs: ["table:main"],
        gitCommit: {
          repositoryFullName: "example/research",
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
      },
      { type: "human", id: leadId },
    );

    await expect(
      testDb.client.sql.unsafe(
        "update research_results set data_version_ref = 'data:mutated' where id = $1",
        [result.id],
      ),
    ).rejects.toThrow(/immutable|append/i);

    await expect(
      testDb.client.sql.unsafe("delete from research_results where id = $1", [result.id]),
    ).rejects.toThrow(/immutable|append/i);
  });

  it("supersedes without deleting or overwriting the old result", async () => {
    const oldResult = await createResearchResult(
      testDb.client.sql,
      {
        projectId,
        dataVersionRef: "data:v1",
        analysisRevisionId,
        executionKind: "manual",
        runRef: "manual-run-old",
        outputRefs: ["figure:old"],
      },
      { type: "human", id: leadId },
    );
    const newResult = await createResearchResult(
      testDb.client.sql,
      {
        projectId,
        dataVersionRef: "data:v2",
        analysisRevisionId,
        executionKind: "manual",
        runRef: "manual-run-new",
        outputRefs: ["figure:new"],
      },
      { type: "human", id: leadId },
    );

    await supersedeResearchResult(
      testDb.client.sql,
      newResult.id,
      oldResult.id,
      { type: "human", id: leadId },
    );

    const oldRows = await testDb.client.sql.unsafe(
      "select data_version_ref from research_results where id = $1",
      [oldResult.id],
    );
    const relation = await testDb.client.sql.unsafe(
      "select old_result_id, new_result_id from research_result_supersessions where old_result_id = $1",
      [oldResult.id],
    );

    expect(oldRows[0]?.data_version_ref).toBe("data:v1");
    expect(relation[0]?.new_result_id).toBe(newResult.id);
  });
});
