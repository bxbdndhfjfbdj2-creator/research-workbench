import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createResearchNode, createNodeRevision } from "../research-graph/node-service";
import { getOfficialRevision } from "../research-graph/official-revision";
import { createScientificDecision } from "./create-decision";
import { reviewScientificDecision } from "./review-decision";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("scientific decision state machine", () => {
  let testDb: TestDatabase;
  const projectId = "decision-project";
  const projectLeadId = "decision-project-lead";
  const orgLeadId = "decision-org-lead";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('decision-team', 'Decision Team')");
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ($1, 'decision-team', 'org@decision.test', 'Org Lead', 'lead', 'human'),
              ($2, 'decision-team', 'project@decision.test', 'Project Lead', 'researcher', 'human')`,
      [orgLeadId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('decision-portfolio', 'decision-team', 'Decision Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'decision-portfolio', 'Decision Project', $2)",
      [projectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('decision-membership', $1, $2, 'lead')",
      [projectId, projectLeadId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("lets the project lead complete a general scientific decision", async () => {
    const decision = await createScientificDecision(
      testDb.client.sql,
      {
        projectId,
        level: "general",
        title: "补做一组描述性检验",
        reason: "澄清异常模式",
        evidence: [],
        impact: ["探索分析"],
        change: { kind: "record_only" },
      },
      { type: "human", id: projectLeadId },
    );

    const approved = await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: projectLeadId },
    );
    expect(approved.status).toBe("approved");
  });

  it("requires project-lead then organization-lead approval for a major official change", async () => {
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "主理论",
      { type: "human", id: projectLeadId },
    );
    const revision = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { summary: "正式理论候选" },
      "候选",
      { type: "human", id: projectLeadId },
    );

    const decision = await createScientificDecision(
      testDb.client.sql,
      {
        projectId,
        level: "major",
        title: "升级正式理论",
        reason: "验证证据支持修订",
        evidence: [{ kind: "result", ref: "result-major" }],
        impact: ["正式理论"],
        change: { kind: "official_revision", slot: "正式理论", revisionId: revision.id },
      },
      { type: "human", id: projectLeadId },
    );

    const afterProjectLead = await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: projectLeadId },
    );
    expect(afterProjectLead.status).toBe("awaiting_lead");
    expect(await getOfficialRevision(testDb.client.sql, projectId, "正式理论")).toBeNull();

    const afterOrgLead = await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: orgLeadId },
    );
    expect(afterOrgLead.status).toBe("approved");

    const official = await getOfficialRevision(testDb.client.sql, projectId, "正式理论");
    expect(official?.id).toBe(revision.id);
  });

  it("forbids AI actors from reviewing scientific decisions", async () => {
    const decision = await createScientificDecision(
      testDb.client.sql,
      {
        projectId,
        level: "general",
        title: "AI 提议",
        reason: "自动发现异常",
        evidence: [],
        impact: ["探索分析"],
        change: { kind: "record_only" },
      },
      { type: "agent", id: "analysis-agent" },
    );

    await expect(
      reviewScientificDecision(
        testDb.client.sql,
        decision.id,
        "approve",
        { type: "agent", id: "analysis-agent" },
      ),
    ).rejects.toThrow(/human|人工|AI/i);
  });
});
