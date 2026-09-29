import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createResearchNode, createNodeRevision } from "./node-service";
import * as officialRevisionApi from "./official-revision";
import {
  getOfficialRevision,
  proposeOfficialRevisionChange,
} from "./official-revision";
import { createScientificDecision } from "../decisions/create-decision";
import { reviewScientificDecision } from "../decisions/review-decision";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("official revision decision boundary", () => {
  let testDb: TestDatabase;
  const projectId = "official-project";
  const projectLeadId = "official-project-lead";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('official-team', 'Official Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ('official-org-lead', 'official-team', 'org@official.test', 'Org Lead', 'lead', 'human'),
              ($1, 'official-team', 'project@official.test', 'Project Lead', 'researcher', 'human')`,
      [projectLeadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('official-portfolio', 'official-team', 'Official Portfolio')",
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ($1, 'official-portfolio', 'Official Project', $2)`,
      [projectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('official-membership', $1, $2, 'lead')`,
      [projectId, projectLeadId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("keeps internal pointer mutation out of the public official revision API", () => {
    expect(Object.keys(officialRevisionApi).sort()).toEqual([
      "getOfficialRevision",
      "proposeOfficialRevisionChange",
    ]);
  });

  it("keeps the official pointer unchanged for an AI proposal", async () => {
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "理论框架",
      { type: "human", id: projectLeadId },
    );
    const revision = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { summary: "候选理论 2.0" },
      "候选",
      { type: "agent", id: "theory-agent" },
    );

    const proposal = await proposeOfficialRevisionChange(
      testDb.client.sql,
      {
        projectId,
        slot: "正式理论",
        revisionId: revision.id,
        reason: "新证据支持候选理论",
        evidence: [{ kind: "result", ref: "result-1" }],
      },
      { type: "agent", id: "theory-agent" },
    );

    expect(proposal.status).toBe("proposed");
    expect(await getOfficialRevision(testDb.client.sql, projectId, "正式理论")).toBeNull();
  });

  it("keeps official revision history append-only", async () => {
    const node = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "历史保护理论",
      { type: "human", id: projectLeadId },
    );
    const revision = await createNodeRevision(
      testDb.client.sql,
      node.id,
      { summary: "受保护的正式历史" },
      "候选",
      { type: "human", id: projectLeadId },
    );
    const decision = await createScientificDecision(
      testDb.client.sql,
      {
        projectId,
        level: "major",
        title: "建立受保护的正式历史",
        reason: "验证正式版本历史不可改写",
        evidence: [],
        impact: ["正式理论"],
        change: { kind: "official_revision", slot: "正式理论", revisionId: revision.id },
      },
      { type: "human", id: projectLeadId },
    );
    await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: projectLeadId },
    );
    await reviewScientificDecision(
      testDb.client.sql,
      decision.id,
      "approve",
      { type: "human", id: "official-org-lead" },
    );

    await expect(
      testDb.client.sql.unsafe(
        "update official_revision_history set slot = '核心研究问题' where decision_id = $1",
        [decision.id],
      ),
    ).rejects.toThrow(/append|immutable/i);

    await expect(
      testDb.client.sql.unsafe(
        "delete from official_revision_history where decision_id = $1",
        [decision.id],
      ),
    ).rejects.toThrow(/append|immutable/i);
  });

  it("rejects direct database pointer changes without an approved decision", async () => {
    const nodes = await testDb.client.sql.unsafe(
      "select id from research_nodes where project_id = $1 order by created_at desc limit 1",
      [projectId],
    );
    const revisions = await testDb.client.sql.unsafe(
      "select id from research_node_revisions where node_id = $1 order by revision_number desc limit 1",
      [nodes[0]?.id],
    );

    await expect(
      testDb.client.sql.unsafe(
        `insert into official_revisions (id, project_id, slot, revision_id, decision_id)
         values ('bypass-pointer', $1, '正式理论', $2, 'missing-decision')`,
        [projectId, revisions[0]?.id],
      ),
    ).rejects.toThrow();
  });
});
