import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { createResearchNode, createNodeRevision } from "../../packages/application/src/research-graph/node-service";
import { createScientificDecision } from "../../packages/application/src/decisions/create-decision";
import { reviewScientificDecision } from "../../packages/application/src/decisions/review-decision";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("scientific decision concurrent approval", () => {
  let testDb: TestDatabase;
  const projectId = "concurrent-decision-project";
  const projectLeadId = "concurrent-project-lead";
  const orgLeadId = "concurrent-org-lead";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('concurrent-team', 'Concurrent Team')");
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ($1, 'concurrent-team', 'org@concurrent.test', 'Org Lead', 'lead', 'human'),
              ($2, 'concurrent-team', 'project@concurrent.test', 'Project Lead', 'researcher', 'human')`,
      [orgLeadId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('concurrent-portfolio', 'concurrent-team', 'Concurrent Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'concurrent-portfolio', 'Concurrent Project', $2)",
      [projectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('concurrent-membership', $1, $2, 'lead')",
      [projectId, projectLeadId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("applies a major decision exactly once under concurrent final reviews", async () => {
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "研究问题",
      "核心问题",
      { type: "human", id: projectLeadId },
    );
    const revision = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { question: "X 如何影响 Y？" },
      "候选",
      { type: "human", id: projectLeadId },
    );
    const decision = await createScientificDecision(
      testDb.client.sql,
      {
        projectId,
        level: "major",
        title: "冻结核心研究问题",
        reason: "进入验证阶段",
        evidence: [],
        impact: ["核心研究问题"],
        change: { kind: "official_revision", slot: "核心研究问题", revisionId: revision.id },
      },
      { type: "human", id: projectLeadId },
    );

    await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: projectLeadId },
    );

    const outcomes = await Promise.allSettled([
      reviewScientificDecision(testDb.client.sql, decision.id, "approve", { type: "human", id: orgLeadId }),
      reviewScientificDecision(testDb.client.sql, decision.id, "approve", { type: "human", id: orgLeadId }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const events = await testDb.client.sql.unsafe(
      `select count(*)::int as count
       from research_events
       where project_id = $1 and event_type = 'OFFICIAL_REVISION_CHANGED'`,
      [projectId],
    );
    expect(events[0]?.count).toBe(1);
  });
});
