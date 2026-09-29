import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createProject } from "../projects/create-project";
import { setProjectMembership } from "../projects/set-project-membership";
import { setDimensionState } from "../projects/set-dimension-state";
import {
  assignResearchTask,
  createResearchTask,
  setResearchTaskStatus,
} from "./research-task-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("research task service", () => {
  let testDb: TestDatabase;
  let projectId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('task-team', 'Task Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('task-lead', 'task-team', 'lead@task.test', 'Lead', 'lead', 'human'), ('task-member', 'task-team', 'member@task.test', 'Member', 'researcher', 'human'), ('task-outsider', 'task-team', 'outside@task.test', 'Outside', 'researcher', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('task-portfolio', 'task-team', 'Portfolio')",
    );

    const project = await createProject(
      testDb.client.sql,
      {
        portfolioId: "task-portfolio",
        title: "Task Project",
        leadMemberId: "task-lead",
      },
      { type: "human", id: "task-lead" },
    );
    projectId = project.id;

    await setProjectMembership(
      testDb.client.sql,
      projectId,
      "task-member",
      "collaborator",
      { type: "human", id: "task-lead" },
    );

    await setDimensionState(
      testDb.client.sql,
      projectId,
      "数据",
      "验证中",
      { type: "human", id: "task-lead" },
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("allows a project member to create and assign a research task", async () => {
    const actor = { type: "human" as const, id: "task-member" };
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "检查异常样本", description: "核对样本排除原因" },
      actor,
    );

    expect(task.status).toBe("open");
    expect(task.projectId).toBe(projectId);

    const assigned = await assignResearchTask(
      testDb.client.sql,
      task.id,
      "task-member",
      actor,
    );
    expect(assigned.assigneeMemberId).toBe("task-member");
  });

  it("rejects a non-project member creating a task", async () => {
    await expect(
      createResearchTask(
        testDb.client.sql,
        projectId,
        { title: "Unauthorized task" },
        { type: "human", id: "task-outsider" },
      ),
    ).rejects.toThrow(/forbidden/i);
  });

  it("appends a research event when task status changes", async () => {
    const actor = { type: "human" as const, id: "task-member" };
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "运行稳健性检查" },
      actor,
    );

    const before = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1 and event_type = 'RESEARCH_TASK_STATUS_CHANGED'",
      [projectId],
    );

    const updated = await setResearchTaskStatus(
      testDb.client.sql,
      task.id,
      "in_progress",
      actor,
    );
    expect(updated.status).toBe("in_progress");

    const after = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1 and event_type = 'RESEARCH_TASK_STATUS_CHANGED'",
      [projectId],
    );
    expect(Number(after[0]?.count) - Number(before[0]?.count)).toBe(1);
  });

  it("completing a task does not mutate formal research dimension state", async () => {
    const actor = { type: "human" as const, id: "task-member" };
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "整理数据质量说明" },
      actor,
    );

    await setResearchTaskStatus(testDb.client.sql, task.id, "completed", actor);

    const rows = await testDb.client.sql.unsafe(
      "select state from research_dimension_states where project_id = $1 and dimension = '数据'",
      [projectId],
    );
    expect(rows[0]?.state).toBe("验证中");
  });
});
