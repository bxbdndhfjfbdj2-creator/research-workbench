import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  RESEARCH_DIMENSIONS,
  RESEARCH_DIMENSION_STATES,
} from "@research-workbench/domain/src/research-dimensions";
import { createProject } from "./create-project";
import { setProjectMembership } from "./set-project-membership";
import { setDimensionState } from "./set-dimension-state";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("project research state services", () => {
  let testDb: TestDatabase;
  let projectId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('project-team', 'Project Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('project-lead', 'project-team', 'lead@project.test', 'Lead', 'lead', 'human'), ('project-member', 'project-team', 'member@project.test', 'Member', 'researcher', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('project-portfolio', 'project-team', 'Portfolio')",
    );

    const project = await createProject(
      testDb.client.sql,
      {
        portfolioId: "project-portfolio",
        title: "Nonlinear Research",
        leadMemberId: "project-lead",
      },
      { type: "human", id: "project-lead" },
    );
    projectId = project.id;

    await setProjectMembership(
      testDb.client.sql,
      projectId,
      "project-member",
      "method_challenger",
      { type: "human", id: "project-lead" },
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("matches the approved dimensions and state vocabulary exactly", () => {
    expect(RESEARCH_DIMENSIONS).toEqual([
      "研究问题", "理论", "测量", "研究设计", "数据", "主分析",
      "机制分析", "稳健性", "论文", "复现", "投稿",
    ]);
    expect(RESEARCH_DIMENSION_STATES).toEqual([
      "未开始", "探索中", "候选", "待审查", "正式", "验证中",
      "稳定", "冻结", "重新开启", "受阻", "退休",
    ]);
  });

  it("stores independent simultaneous dimension states", async () => {
    const actor = { type: "human" as const, id: "project-lead" };
    await setDimensionState(testDb.client.sql, projectId, "理论", "探索中", actor);
    await setDimensionState(testDb.client.sql, projectId, "数据", "冻结", actor);
    await setDimensionState(testDb.client.sql, projectId, "主分析", "验证中", actor);

    const rows = await testDb.client.sql.unsafe(
      "select dimension, state from research_dimension_states where project_id = $1 order by dimension",
      [projectId],
    );
    const stateByDimension = Object.fromEntries(
      rows.map((row) => [String(row.dimension), String(row.state)]),
    );

    expect(stateByDimension).toMatchObject({
      理论: "探索中",
      数据: "冻结",
      主分析: "验证中",
    });
  });

  it("allows non-linear reopening and appends a research event for every formal change", async () => {
    const actor = { type: "human" as const, id: "project-lead" };
    const before = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1 and event_type = 'RESEARCH_STATE_CHANGED'",
      [projectId],
    );

    await setDimensionState(testDb.client.sql, projectId, "理论", "正式", actor);
    await setDimensionState(testDb.client.sql, projectId, "理论", "重新开启", actor);

    const after = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1 and event_type = 'RESEARCH_STATE_CHANGED'",
      [projectId],
    );

    expect(Number(after[0]?.count) - Number(before[0]?.count)).toBe(2);

    const current = await testDb.client.sql.unsafe(
      "select state from research_dimension_states where project_id = $1 and dimension = '理论'",
      [projectId],
    );
    expect(current[0]?.state).toBe("重新开启");
  });

  it("rejects an agent attempting to directly change formal research state", async () => {
    await expect(
      setDimensionState(
        testDb.client.sql,
        projectId,
        "研究设计",
        "正式",
        { type: "agent", id: "agent-1" },
      ),
    ).rejects.toThrow(/human|agent|formal/i);
  });
});
