import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  createResearchNode,
  createNodeRevision,
  linkResearchNodes,
} from "../../packages/application/src/research-graph/node-service";
import {
  createResearchBranch,
  closeResearchBranch,
  reopenResearchBranch,
} from "../../packages/application/src/research-graph/branch-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("nonlinear research graph", () => {
  let testDb: TestDatabase;
  const projectId = "graph-project";
  const leadId = "graph-lead";
  const actor = { type: "human" as const, id: leadId };

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('graph-team', 'Graph Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ($1, 'graph-team', 'lead@graph.test', 'Graph Lead', 'lead', 'human')`,
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('graph-portfolio', 'graph-team', 'Graph Portfolio')",
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ($1, 'graph-portfolio', 'Graph Project', $2)`,
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('graph-membership', $1, $2, 'lead')`,
      [projectId, leadId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("keeps node revisions immutable instead of overwriting them", async () => {
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "理论机制",
      actor,
    );
    const revision1 = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { summary: "初始机制" },
      "候选",
      actor,
    );
    const revision2 = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { summary: "修订机制" },
      "候选",
      actor,
    );

    expect(revision1.id).not.toBe(revision2.id);
    expect(revision1.revisionNumber).toBe(1);
    expect(revision2.revisionNumber).toBe(2);

    await expect(
      testDb.client.sql.unsafe(
        "update research_node_revisions set content = '{\"summary\":\"覆盖\"}'::jsonb where id = $1",
        [revision1.id],
      ),
    ).rejects.toThrow(/immutable|append/i);
  });

  it("allows cycles such as A to B to A", async () => {
    const a = await createResearchNode(testDb.client.sql, projectId, "研究问题", "问题 A", actor);
    const b = await createResearchNode(testDb.client.sql, projectId, "机制", "机制 B", actor);

    const first = await linkResearchNodes(testDb.client.sql, a.id, b.id, "检验", actor);
    const second = await linkResearchNodes(testDb.client.sql, b.id, a.id, "回到", actor);

    expect(first.fromNodeId).toBe(a.id);
    expect(second.fromNodeId).toBe(b.id);

    const rows = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_edges where project_id = $1",
      [projectId],
    );
    expect(rows[0]?.count).toBeGreaterThanOrEqual(2);
  });

  it("preserves branch termination history when reopened", async () => {
    const origin = await createResearchNode(
      testDb.client.sql,
      projectId,
      "假设",
      "竞争假设",
      actor,
    );
    const branch = await createResearchBranch(
      testDb.client.sql,
      projectId,
      "失败但保留的路线",
      origin.id,
      actor,
    );

    await closeResearchBranch(
      testDb.client.sql,
      branch.id,
      "关键测量无法支持该机制",
      actor,
    );
    await reopenResearchBranch(testDb.client.sql, branch.id, actor);

    const history = await testDb.client.sql.unsafe(
      `select action, reason
       from research_branch_history
       where branch_id = $1
       order by created_at asc, id asc`,
      [branch.id],
    );

    expect(history.map((row) => row.action)).toEqual(["created", "closed", "reopened"]);
    expect(history.find((row) => row.action === "closed")?.reason).toBe(
      "关键测量无法支持该机制",
    );

    const events = await testDb.client.sql.unsafe(
      `select event_type
       from research_events
       where project_id = $1
       order by created_at asc, id asc`,
      [projectId],
    );
    expect(events.map((row) => row.event_type)).toContain("RESEARCH_BRANCH_REOPENED");
  });
});
