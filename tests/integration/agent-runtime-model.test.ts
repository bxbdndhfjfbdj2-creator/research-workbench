import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { createResearchTask } from "../../packages/application/src/tasks/research-task-service";
import { createResearchNode, createNodeRevision } from "../../packages/application/src/research-graph/node-service";
import { createAgentTask } from "../../packages/application/src/agents/create-agent-task";
import { createAgentRun } from "../../packages/application/src/agents/create-agent-run";
import { buildAgentContextSnapshot } from "../../packages/application/src/agents/context-snapshot";
import {
  AGENT_RUN_STATES,
  type AgentExecutionPolicy,
} from "../../packages/domain/src/agent-runtime";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("durable agent task and run model", () => {
  let testDb: TestDatabase;
  const projectId = "agent-model-project";
  const leadId = "agent-model-lead";
  const actor = { type: "human" as const, id: leadId };
  let researchTaskId: string;
  let theoryRevision1: string;
  let theoryRevision2: string;

  const executionPolicy: AgentExecutionPolicy = {
    sandboxPolicy: "workspace-write",
    toolAllowlist: ["read_file", "write_file"],
    subagentAllowlist: ["codex"],
    runtimeProfile: "research-execution",
    harnessVersion: "pinned-test-version",
    harnessProfile: "workbench",
    modelRoute: "default",
    skillVersionRefs: ["skill:research-analysis@1"],
    gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
  };

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('agent-model-team', 'Agent Model Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ($1, 'agent-model-team', 'lead@agent-model.test', 'Lead', 'lead', 'human')",
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('agent-model-portfolio', 'agent-model-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'agent-model-portfolio', 'Agent Model Project', $2)",
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('agent-model-membership', $1, $2, 'lead')",
      [projectId, leadId],
    );

    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "解释主效应下降原因" },
      actor,
    );
    researchTaskId = task.id;

    const theoryNode = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "机制理论",
      actor,
    );
    const r1 = await createNodeRevision(
      testDb.client.sql,
      theoryNode.id,
      { summary: "理论版本 1" },
      "候选",
      actor,
    );
    const r2 = await createNodeRevision(
      testDb.client.sql,
      theoryNode.id,
      { summary: "理论版本 2" },
      "候选",
      actor,
    );
    theoryRevision1 = r1.id;
    theoryRevision2 = r2.id;
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("matches the approved AgentRun state vocabulary exactly", () => {
    expect(AGENT_RUN_STATES).toEqual([
      "已提议",
      "等待授权",
      "排队",
      "已派发",
      "执行中",
      "等待人工输入",
      "继续执行",
      "完成",
      "失败",
      "取消",
      "被替代",
    ]);
  });

  it("does not allow a run without a context snapshot to enter queued", async () => {
    const agentTask = await createAgentTask(
      testDb.client.sql,
      researchTaskId,
      { objective: "检查异常变化", expectedOutput: "结构化诊断" },
      actor,
    );
    const run = await createAgentRun(
      testDb.client.sql,
      agentTask.id,
      { ...executionPolicy, contextSnapshotId: null },
      actor,
    );

    expect(run.state).toBe("已提议");
    await expect(
      testDb.client.sql.unsafe(
        "update agent_runs set state = '排队' where id = $1",
        [run.id],
      ),
    ).rejects.toThrow(/snapshot|context/i);
  });

  it("keeps snapshots immutable and bound to creation-time revision refs", async () => {
    const snapshot = await buildAgentContextSnapshot(
      testDb.client.sql,
      projectId,
      {
        researchQuestionRevisionId: null,
        theoryRevisionId: theoryRevision1,
        researchDesignRevisionId: null,
        dataVersionRef: "data:v3",
        assetVersionRefs: ["asset:dictionary@2"],
        ...executionPolicy,
      },
      actor,
    );

    expect(snapshot.theoryRevisionId).toBe(theoryRevision1);

    await expect(
      testDb.client.sql.unsafe(
        "update agent_context_snapshots set theory_revision_id = $2 where id = $1",
        [snapshot.id, theoryRevision2],
      ),
    ).rejects.toThrow(/immutable|append/i);

    const rows = await testDb.client.sql.unsafe(
      "select theory_revision_id from agent_context_snapshots where id = $1",
      [snapshot.id],
    );
    expect(rows[0]?.theory_revision_id).toBe(theoryRevision1);
  });

  it("rejects secret-bearing snapshot content", async () => {
    await expect(
      buildAgentContextSnapshot(
        testDb.client.sql,
        projectId,
        {
          researchQuestionRevisionId: null,
          theoryRevisionId: theoryRevision1,
          researchDesignRevisionId: null,
          dataVersionRef: "data:v3",
          assetVersionRefs: [],
          ...executionPolicy,
          executionMetadata: { token: "must-not-persist" },
        },
        actor,
      ),
    ).rejects.toThrow(/secret|credential|sensitive/i);
  });

  it("preserves failed run attempt one when attempt two is created", async () => {
    const agentTask = await createAgentTask(
      testDb.client.sql,
      researchTaskId,
      { objective: "重新运行诊断", expectedOutput: "结构化诊断" },
      actor,
    );
    const snapshot = await buildAgentContextSnapshot(
      testDb.client.sql,
      projectId,
      {
        researchQuestionRevisionId: null,
        theoryRevisionId: theoryRevision1,
        researchDesignRevisionId: null,
        dataVersionRef: "data:v3",
        assetVersionRefs: [],
        ...executionPolicy,
      },
      actor,
    );

    const run1 = await createAgentRun(
      testDb.client.sql,
      agentTask.id,
      { ...executionPolicy, contextSnapshotId: snapshot.id },
      actor,
    );
    await testDb.client.sql.unsafe(
      "update agent_runs set state = '失败', failure_code = 'HARNESS_UNAVAILABLE' where id = $1",
      [run1.id],
    );

    const run2 = await createAgentRun(
      testDb.client.sql,
      agentTask.id,
      { ...executionPolicy, contextSnapshotId: snapshot.id },
      actor,
    );

    expect(run1.attemptNumber).toBe(1);
    expect(run2.attemptNumber).toBe(2);
    expect(run2.id).not.toBe(run1.id);

    const rows = await testDb.client.sql.unsafe(
      "select id, attempt_number, state from agent_runs where agent_task_id = $1 order by attempt_number",
      [agentTask.id],
    );
    expect(rows.map((row) => [row.attempt_number, row.state])).toEqual([
      [1, "失败"],
      [2, "已提议"],
    ]);
  });
});
