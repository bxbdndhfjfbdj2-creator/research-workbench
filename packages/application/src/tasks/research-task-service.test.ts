import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createProject } from "../projects/create-project";
import { setProjectMembership } from "../projects/set-project-membership";
import { setDimensionState } from "../projects/set-dimension-state";
import {
  assignResearchTaskOwner,
  blockResearchTask,
  cancelResearchTask,
  completeUnreviewedTask,
  createResearchTask,
  reopenResearchTask,
  setResearchTaskExecutionMode,
  setResearchTaskReviewPolicy,
  startResearchTask,
  unblockResearchTask,
  updateResearchTaskRequirements,
} from "./research-task-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("research task workflow v2", () => {
  let testDb: TestDatabase;
  let projectId: string;

  const orgLeadId = "task-org-lead";
  const projectLeadId = "task-project-lead";
  const memberId = "task-member";
  const otherId = "task-other";
  const inactiveId = "task-inactive";
  const outsiderId = "task-outsider";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('task-team', 'Task Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ($1, 'task-team', 'org-lead@task.test', 'Org Lead', 'lead', 'human', true),
        ($2, 'task-team', 'project-lead@task.test', 'Project Lead', 'researcher', 'human', true),
        ($3, 'task-team', 'member@task.test', 'Member', 'researcher', 'human', true),
        ($4, 'task-team', 'other@task.test', 'Other', 'researcher', 'human', true),
        ($5, 'task-team', 'inactive@task.test', 'Inactive', 'researcher', 'human', true),
        ($6, 'task-team', 'outside@task.test', 'Outside', 'researcher', 'human', true)`,
      [orgLeadId, projectLeadId, memberId, otherId, inactiveId, outsiderId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('task-portfolio', 'task-team', 'Portfolio')",
    );

    const project = await createProject(
      testDb.client.sql,
      {
        portfolioId: "task-portfolio",
        title: "Task Project",
        leadMemberId: projectLeadId,
      },
      { type: "human", id: projectLeadId },
    );
    projectId = project.id;

    for (const [id, role] of [
      [memberId, "collaborator"],
      [otherId, "collaborator"],
      [inactiveId, "collaborator"],
    ] as const) {
      await setProjectMembership(
        testDb.client.sql,
        projectId,
        id,
        role,
        { type: "human", id: projectLeadId },
      );
    }
    await testDb.client.sql.unsafe(
      "update members set active = false where id = $1",
      [inactiveId],
    );

    await setDimensionState(
      testDb.client.sql,
      projectId,
      "数据",
      "验证中",
      { type: "human", id: projectLeadId },
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createMemberTask(
    title = "检查异常样本",
    overrides: Partial<{
      assigneeMemberId: string;
      executionMode: "human" | "agent" | "hybrid";
      reviewPolicy: "none" | "required";
      acceptanceCriteria: string[];
    }> = {},
  ) {
    return createResearchTask(
      testDb.client.sql,
      projectId,
      {
        title,
        description: "核对样本排除原因",
        ...overrides,
      },
      { type: "human", id: memberId },
    );
  }

  async function insertSubmission(
    taskId: string,
    number: number,
    submittedBy = memberId,
  ): Promise<string> {
    const id = randomUUID();
    await testDb.client.sql.unsafe(
      `insert into task_submissions
        (id, research_task_id, project_id, submission_number, summary,
         requirement_snapshot, requirement_snapshot_schema_version,
         submitted_by_member_id)
       values ($1, $2, $3, $4, 'Formal submission',
               '{}'::jsonb, 1, $5)`,
      [id, taskId, projectId, number, submittedBy],
    );
    return id;
  }

  it("creates workflow-v2 tasks with the human creator as default accountable owner", async () => {
    const task = await createMemberTask();

    expect(task).toMatchObject({
      status: "open",
      projectId,
      assigneeMemberId: memberId,
      executionMode: "human",
      reviewPolicy: "none",
      acceptanceCriteria: [],
      workflowVersion: 2,
    });

    const events = await testDb.client.sql.unsafe(
      `select payload from research_events
       where project_id = $1
         and event_type = 'RESEARCH_TASK_CREATED'
         and payload->>'researchTaskId' = $2`,
      [projectId, task.id],
    );
    expect(events[0]?.payload).toMatchObject({
      researchTaskId: task.id,
      assigneeMemberId: memberId,
    });
    expect(events[0]?.payload).not.toHaveProperty("title");
  });

  it("rejects non-human and non-project task creation", async () => {
    await expect(
      createResearchTask(
        testDb.client.sql,
        projectId,
        { title: "Agent cannot own formal task" },
        { type: "agent", id: "task-agent" },
      ),
    ).rejects.toThrow(/human/i);

    await expect(
      createResearchTask(
        testDb.client.sql,
        projectId,
        { title: "Unauthorized task" },
        { type: "human", id: outsiderId },
      ),
    ).rejects.toThrow(/forbidden/i);
  });

  it("validates bounded task requirements", async () => {
    await expect(
      createMemberTask("x".repeat(201)),
    ).rejects.toThrow(/title/i);

    const task = await createMemberTask("Bounded requirements");
    await expect(
      updateResearchTaskRequirements(
        testDb.client.sql,
        task.id,
        {
          title: "Valid",
          description: "x".repeat(4_001),
          acceptanceCriteria: [],
        },
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/description/i);

    await expect(
      updateResearchTaskRequirements(
        testDb.client.sql,
        task.id,
        {
          title: "Valid",
          description: null,
          acceptanceCriteria: Array.from({ length: 21 }, (_, i) => `criterion-${i}`),
        },
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/criteria/i);
  });

  it("lets owner, project lead, and team lead manage requirements and execution mode but not an unrelated collaborator", async () => {
    const task = await createMemberTask("Managed task");

    await updateResearchTaskRequirements(
      testDb.client.sql,
      task.id,
      {
        title: "Owner update",
        description: "owner",
        acceptanceCriteria: ["criterion"],
      },
      { type: "human", id: memberId },
    );
    await setResearchTaskExecutionMode(
      testDb.client.sql,
      task.id,
      "hybrid",
      { type: "human", id: projectLeadId },
    );
    const updated = await setResearchTaskExecutionMode(
      testDb.client.sql,
      task.id,
      "agent",
      { type: "human", id: orgLeadId },
    );
    expect(updated.executionMode).toBe("agent");

    await expect(
      updateResearchTaskRequirements(
        testDb.client.sql,
        task.id,
        { title: "Other update", description: null, acceptanceCriteria: [] },
        { type: "human", id: otherId },
      ),
    ).rejects.toThrow(/forbidden|owner|lead/i);
  });

  it("restricts accountable owner reassignment to project or team lead", async () => {
    const task = await createMemberTask("Owner reassignment");

    await expect(
      assignResearchTaskOwner(
        testDb.client.sql,
        task.id,
        otherId,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/forbidden|lead/i);

    const reassigned = await assignResearchTaskOwner(
      testDb.client.sql,
      task.id,
      otherId,
      { type: "human", id: projectLeadId },
    );
    expect(reassigned.assigneeMemberId).toBe(otherId);
  });

  it("recalculates accountable-owner eligibility at action time", async () => {
    const task = await createMemberTask("Stale owner");
    await testDb.client.sql.unsafe(
      "update members set active = false where id = $1",
      [memberId],
    );

    await expect(
      startResearchTask(
        testDb.client.sql,
        task.id,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/inactive|access|owner|forbidden/i);

    await testDb.client.sql.unsafe(
      "update members set active = true where id = $1",
      [memberId],
    );
  });

  it("locks reviewPolicy after the first formal submission", async () => {
    const task = await createMemberTask("Policy lock");
    const changed = await setResearchTaskReviewPolicy(
      testDb.client.sql,
      task.id,
      "required",
      { type: "human", id: memberId },
    );
    expect(changed.reviewPolicy).toBe("required");

    await insertSubmission(task.id, 1);

    await expect(
      setResearchTaskReviewPolicy(
        testDb.client.sql,
        task.id,
        "none",
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/submission|locked|review policy/i);
  });

  it("uses explicit business transitions for v2 lifecycle", async () => {
    const task = await createMemberTask("Lifecycle");
    const started = await startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    expect(started.status).toBe("in_progress");

    await expect(
      startResearchTask(
        testDb.client.sql,
        task.id,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/state|open/i);

    const blocked = await blockResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    expect(blocked.status).toBe("blocked");

    const resumed = await unblockResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    expect(resumed.status).toBe("in_progress");

    const cancelled = await cancelResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    expect(cancelled.status).toBe("cancelled");

    await expect(
      reopenResearchTask(
        testDb.client.sql,
        task.id,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/completed|state/i);
  });

  it("upgrades an active legacy v1 task exactly once before its first lifecycle mutation without fabricating provenance", async () => {
    const taskId = randomUUID();
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, workflow_version, created_by)
       values ($1, $2, 'Legacy active', 'open', $3, 1, $3)`,
      [taskId, projectId, memberId],
    );

    const started = await startResearchTask(
      testDb.client.sql,
      taskId,
      { type: "human", id: memberId },
    );
    expect(started.workflowVersion).toBe(2);
    expect(started.status).toBe("in_progress");

    const eventRows = await testDb.client.sql.unsafe(
      `select payload from research_events
       where project_id = $1
         and event_type = 'RESEARCH_TASK_WORKFLOW_UPGRADED'
         and payload->>'researchTaskId' = $2`,
      [projectId, taskId],
    );
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.payload).toEqual({
      researchTaskId: taskId,
      fromVersion: 1,
      toVersion: 2,
    });

    const submissionRows = await testDb.client.sql.unsafe(
      "select id from task_submissions where research_task_id = $1",
      [taskId],
    );
    expect(submissionRows).toHaveLength(0);
    const reviewRows = await testDb.client.sql.unsafe(
      `select rr.id
       from review_requests rr
       join task_submissions ts on ts.id = rr.task_submission_id
       where ts.research_task_id = $1`,
      [taskId],
    );
    expect(reviewRows).toHaveLength(0);
  });

  it("fails legacy upgrade with an invalid owner until a lead atomically reassigns a valid owner", async () => {
    const taskId = randomUUID();
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, workflow_version, created_by)
       values ($1, $2, 'Legacy stale owner', 'open', $3, 1, $4)`,
      [taskId, projectId, inactiveId, projectLeadId],
    );

    await expect(
      startResearchTask(
        testDb.client.sql,
        taskId,
        { type: "human", id: projectLeadId },
      ),
    ).rejects.toThrow(/owner|active|access/i);

    const reassigned = await assignResearchTaskOwner(
      testDb.client.sql,
      taskId,
      memberId,
      { type: "human", id: projectLeadId },
    );
    expect(reassigned).toMatchObject({
      assigneeMemberId: memberId,
      workflowVersion: 2,
    });
  });

  it("upgrades a completed legacy task when a valid owner explicitly reopens it", async () => {
    const taskId = randomUUID();
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, workflow_version, created_by)
       values ($1, $2, 'Legacy complete', 'completed', $3, 1, $3)`,
      [taskId, projectId, memberId],
    );

    const reopened = await reopenResearchTask(
      testDb.client.sql,
      taskId,
      { type: "human", id: memberId },
    );
    expect(reopened).toMatchObject({
      status: "in_progress",
      workflowVersion: 2,
    });
  });

  it("completes an unreviewed task only against its latest own formal submission and records accepted provenance", async () => {
    const task = await createMemberTask("Explicit completion");
    await startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    const first = await insertSubmission(task.id, 1);
    const latest = await insertSubmission(task.id, 2);

    await expect(
      completeUnreviewedTask(
        testDb.client.sql,
        task.id,
        first,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/latest|submission/i);

    const completed = await completeUnreviewedTask(
      testDb.client.sql,
      task.id,
      latest,
      { type: "human", id: memberId },
    );
    expect(completed.status).toBe("completed");

    const events = await testDb.client.sql.unsafe(
      `select payload from research_events
       where project_id = $1
         and event_type = 'RESEARCH_TASK_COMPLETED'
         and payload->>'researchTaskId' = $2`,
      [projectId, task.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      researchTaskId: task.id,
      submissionId: latest,
      completionKind: "unreviewed_acceptance",
    });

    const reopened = await reopenResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: memberId },
    );
    expect(reopened.status).toBe("in_progress");
    expect(
      await testDb.client.sql.unsafe(
        `select id from research_events
         where event_type = 'RESEARCH_TASK_COMPLETED'
           and payload->>'submissionId' = $1`,
        [latest],
      ),
    ).toHaveLength(1);
  });

  it("rejects required-review, wrong-task, and non-owner unreviewed completion", async () => {
    const required = await createMemberTask("Required completion", {
      reviewPolicy: "required",
    });
    await startResearchTask(
      testDb.client.sql,
      required.id,
      { type: "human", id: memberId },
    );
    const requiredSubmission = await insertSubmission(required.id, 1);

    await expect(
      completeUnreviewedTask(
        testDb.client.sql,
        required.id,
        requiredSubmission,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/review|required/i);

    const first = await createMemberTask("Own first");
    const second = await createMemberTask("Own second");
    await startResearchTask(testDb.client.sql, first.id, { type: "human", id: memberId });
    await startResearchTask(testDb.client.sql, second.id, { type: "human", id: memberId });
    const secondSubmission = await insertSubmission(second.id, 1);

    await expect(
      completeUnreviewedTask(
        testDb.client.sql,
        first.id,
        secondSubmission,
        { type: "human", id: memberId },
      ),
    ).rejects.toThrow(/submission|task/i);

    const firstSubmission = await insertSubmission(first.id, 1);
    await expect(
      completeUnreviewedTask(
        testDb.client.sql,
        first.id,
        firstSubmission,
        { type: "human", id: projectLeadId },
      ),
    ).rejects.toThrow(/owner|forbidden/i);
  });

  it("does not let task completion mutate formal research dimension state", async () => {
    const task = await createMemberTask("整理数据质量说明");
    await startResearchTask(testDb.client.sql, task.id, { type: "human", id: memberId });
    const submissionId = await insertSubmission(task.id, 1);
    await completeUnreviewedTask(
      testDb.client.sql,
      task.id,
      submissionId,
      { type: "human", id: memberId },
    );

    const rows = await testDb.client.sql.unsafe(
      "select state from research_dimension_states where project_id = $1 and dimension = '数据'",
      [projectId],
    );
    expect(rows[0]?.state).toBe("验证中");
  });
});
