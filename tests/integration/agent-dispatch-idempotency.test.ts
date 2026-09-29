import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { createResearchTask } from "../../packages/application/src/tasks/research-task-service";
import { createResearchNode, createNodeRevision } from "../../packages/application/src/research-graph/node-service";
import { createAgentTask } from "../../packages/application/src/agents/create-agent-task";
import { createAgentRun } from "../../packages/application/src/agents/create-agent-run";
import { buildAgentContextSnapshot } from "../../packages/application/src/agents/context-snapshot";
import { queueAgentRun } from "../../packages/application/src/agents/run-lifecycle";
import { dispatchAgentRun } from "../../packages/queue/src/agent-dispatch";
import { FakeHarnessAdapter } from "../../packages/harness-adapter/src/fake-adapter";
import type {
  HarnessExecutionRequest,
  HarnessHealth,
} from "../../packages/harness-adapter/src/types";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

class CountingFakeAdapter extends FakeHarnessAdapter {
  startCalls = 0;

  override async start(request: HarnessExecutionRequest) {
    this.startCalls += 1;
    return super.start(request);
  }
}

describe("AgentRun dispatch idempotency", () => {
  let testDb: TestDatabase;
  const projectId = "agent-dispatch-project";
  const leadId = "agent-dispatch-lead";
  const actor = { type: "human" as const, id: leadId };
  let researchTaskId: string;
  let snapshotId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('agent-dispatch-team', 'Agent Dispatch Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ($1, 'agent-dispatch-team', 'lead@dispatch.test', 'Lead', 'lead', 'human')",
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('agent-dispatch-portfolio', 'agent-dispatch-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'agent-dispatch-portfolio', 'Dispatch Project', $2)",
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('agent-dispatch-membership', $1, $2, 'lead')",
      [projectId, leadId],
    );

    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "运行智能诊断" },
      actor,
    );
    researchTaskId = task.id;

    const snapshot = await buildAgentContextSnapshot(
      testDb.client.sql,
      projectId,
      {
        researchQuestionRevisionId: null,
        theoryRevisionId: null,
        researchDesignRevisionId: null,
        dataVersionRef: "data:v1",
        assetVersionRefs: [],
        gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
        skillVersionRefs: ["skill:diagnostic@1"],
        harnessVersion: "test",
        harnessProfile: "workbench",
        runtimeProfile: "research-execution",
        modelRoute: "default",
        sandboxPolicy: "workspace-write",
        toolAllowlist: ["read_file"],
        subagentAllowlist: [],
      },
      actor,
    );
    snapshotId = snapshot.id;
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createQueuedRun(label: string) {
    const task = await createAgentTask(
      testDb.client.sql,
      researchTaskId,
      { objective: label, expectedOutput: "诊断摘要" },
      actor,
    );
    const run = await createAgentRun(
      testDb.client.sql,
      task.id,
      {
        contextSnapshotId: snapshotId,
        gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
        skillVersionRefs: ["skill:diagnostic@1"],
        harnessVersion: "test",
        harnessProfile: "workbench",
        runtimeProfile: "research-execution",
        modelRoute: "default",
        sandboxPolicy: "workspace-write",
        toolAllowlist: ["read_file"],
        subagentAllowlist: [],
      },
      actor,
    );
    await queueAgentRun(testDb.client.sql, run.id, actor);
    return run;
  }

  it("calls adapter.start exactly once for concurrent duplicate dispatches", async () => {
    const run = await createQueuedRun("并发幂等");
    const adapter = new CountingFakeAdapter([
      {
        state: "completed",
        sessionId: "session-idempotent",
        result: {
          visibleMessageSummary: "完成",
          toolFacts: [],
          artifactRefs: [],
          githubHints: [],
          scientificChangeProposals: [],
          stopReason: "completed",
        },
      },
    ]);

    await Promise.all([
      dispatchAgentRun(testDb.client.sql, adapter, run.id),
      dispatchAgentRun(testDb.client.sql, adapter, run.id),
    ]);

    expect(adapter.startCalls).toBe(1);
    const rows = await testDb.client.sql.unsafe(
      "select state from agent_runs where id = $1",
      [run.id],
    );
    expect(rows[0]?.state).toBe("完成");
  });

  it("keeps the same run retryable when Harness is unavailable", async () => {
    const run = await createQueuedRun("Harness 不可用");
    const health: HarnessHealth = {
      status: "unavailable",
      detail: "test outage",
    };
    const adapter = new CountingFakeAdapter([], health);

    await expect(
      dispatchAgentRun(testDb.client.sql, adapter, run.id),
    ).rejects.toThrow(/unavailable|Harness/i);

    expect(adapter.startCalls).toBe(0);
    const rows = await testDb.client.sql.unsafe(
      "select state, failure_code from agent_runs where id = $1",
      [run.id],
    );
    expect(rows[0]?.state).toBe("排队");
    expect(rows[0]?.failure_code).toBe("HARNESS_UNAVAILABLE");

    const attempts = await testDb.client.sql.unsafe(
      "select count(*)::int as count from agent_runs where agent_task_id = $1",
      [(await testDb.client.sql.unsafe("select agent_task_id from agent_runs where id = $1", [run.id]))[0]?.agent_task_id],
    );
    expect(attempts[0]?.count).toBe(1);
  });

  it("rolls back all completed-output facts when scientific proposal ingestion fails", async () => {
    const analysisNode = await createResearchNode(
      testDb.client.sql,
      projectId,
      "分析方案",
      "派发原子性分析方案",
      actor,
    );
    const analysisRevision = await createNodeRevision(
      testDb.client.sql,
      analysisNode.id,
      { summary: "原子性分析方案 v1" },
      "候选",
      actor,
    );
    const run = await createQueuedRun("完成结果原子落库");
    const adapter = new CountingFakeAdapter([
      {
        state: "completed",
        sessionId: "session-atomic",
        result: {
          visibleMessageSummary: "Harness 已完成，但 proposal 非法",
          toolFacts: [{ tool: "read_file", summary: "读取输入" }],
          artifactRefs: ["artifact:must-rollback"],
          githubHints: [],
          researchResult: {
            dataVersionRef: "data:v1",
            analysisRevisionId: analysisRevision.id,
            executionKind: "manual",
            outputRefs: ["artifact:must-rollback"],
          },
          scientificChangeProposals: [
            {
              title: "非法正式理论变更",
              reason: "用于验证事务回滚",
              evidence: [],
              impact: ["正式理论"],
              change: {
                kind: "official_revision",
                slot: "正式理论",
                revisionId: "missing-revision",
              },
            },
          ],
          stopReason: "completed",
        },
      },
    ]);

    await expect(
      dispatchAgentRun(testDb.client.sql, adapter, run.id),
    ).rejects.toThrow(/revision|project|proposal/i);

    const [runRows, artifactRows, resultRows, decisionRows, completionEvents] =
      await Promise.all([
        testDb.client.sql.unsafe(
          "select state, failure_code from agent_runs where id = $1",
          [run.id],
        ),
        testDb.client.sql.unsafe(
          "select id from agent_run_artifacts where run_id = $1",
          [run.id],
        ),
        testDb.client.sql.unsafe(
          "select id from research_results where run_ref = $1",
          [run.id],
        ),
        testDb.client.sql.unsafe(
          "select id from scientific_decisions where proposed_by_type = 'agent' and proposed_by_id = $1",
          ["agent-run:" + run.id],
        ),
        testDb.client.sql.unsafe(
          "select id from research_events where project_id = $1 and event_type = 'AGENT_RUN_COMPLETED' and payload->>'agentRunId' = $2",
          [projectId, run.id],
        ),
      ]);

    expect(runRows[0]).toMatchObject({
      state: "失败",
      failure_code: "INVALID_AGENT_OUTPUT",
    });
    expect(artifactRows).toHaveLength(0);
    expect(resultRows).toHaveLength(0);
    expect(decisionRows).toHaveLength(0);
    expect(completionEvents).toHaveLength(0);
  });

  it("does not dispatch a completed run again", async () => {
    const run = await createQueuedRun("完成后重复投递");
    const adapter = new CountingFakeAdapter([
      {
        state: "completed",
        sessionId: "session-completed",
        result: {
          visibleMessageSummary: "完成",
          toolFacts: [],
          artifactRefs: [],
          githubHints: [],
          scientificChangeProposals: [],
          stopReason: "completed",
        },
      },
    ]);

    await dispatchAgentRun(testDb.client.sql, adapter, run.id);
    await dispatchAgentRun(testDb.client.sql, adapter, run.id);

    expect(adapter.startCalls).toBe(1);
  });
});
