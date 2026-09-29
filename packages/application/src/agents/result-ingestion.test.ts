import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createResearchTask } from "../tasks/research-task-service";
import { createResearchNode, createNodeRevision } from "../research-graph/node-service";
import { createAgentTask } from "./create-agent-task";
import { createAgentRun } from "./create-agent-run";
import { buildAgentContextSnapshot } from "./context-snapshot";
import { ingestAgentResult } from "./result-ingestion";
import type { AgentExecutionPolicy } from "@research-workbench/domain/src/agent-runtime";
import type { HarnessExecutionResult } from "../../../harness-adapter/src/types";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("controlled Agent result ingestion", () => {
  let testDb: TestDatabase;
  const projectId = "agent-ingestion-project";
  const leadId = "agent-ingestion-lead";
  const actor = { type: "human" as const, id: leadId };
  let analysisRevisionId: string;
  let theoryRevisionId: string;
  let agentTaskId: string;
  let snapshotId: string;
  let executionPolicy: AgentExecutionPolicy;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('agent-ingestion-team', 'Agent Ingestion Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ($1, 'agent-ingestion-team', 'lead@ingestion.test', 'Lead', 'lead', 'human')",
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('agent-ingestion-portfolio', 'agent-ingestion-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'agent-ingestion-portfolio', 'Ingestion Project', $2)",
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('agent-ingestion-membership', $1, $2, 'lead')",
      [projectId, leadId],
    );

    const analysisNode = await createResearchNode(
      testDb.client.sql,
      projectId,
      "分析方案",
      "主分析方案",
      actor,
    );
    analysisRevisionId = (
      await createNodeRevision(
        testDb.client.sql,
        analysisNode.id,
        { summary: "主分析 v1" },
        "候选",
        actor,
      )
    ).id;

    const theoryNode = await createResearchNode(
      testDb.client.sql,
      projectId,
      "理论",
      "机制理论",
      actor,
    );
    theoryRevisionId = (
      await createNodeRevision(
        testDb.client.sql,
        theoryNode.id,
        { summary: "候选理论 v2" },
        "候选",
        actor,
      )
    ).id;

    const researchTask = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "结构化结果入库" },
      actor,
    );
    const agentTask = await createAgentTask(
      testDb.client.sql,
      researchTask.id,
      { objective: "生成结构化科研结果" },
      actor,
    );
    agentTaskId = agentTask.id;

    executionPolicy = {
      gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
      skillVersionRefs: [],
      harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      harnessProfile: "sdk",
      runtimeProfile: "research-execution",
      modelRoute: "deepseek-official/deepseek-v4-flash",
      sandboxPolicy: "workspace-write",
      toolAllowlist: ["read_file"],
      subagentAllowlist: [],
    };
    const snapshot = await buildAgentContextSnapshot(
      testDb.client.sql,
      projectId,
      {
        researchQuestionRevisionId: null,
        theoryRevisionId,
        researchDesignRevisionId: null,
        dataVersionRef: "data:v3",
        assetVersionRefs: [],
        ...executionPolicy,
      },
      actor,
    );
    snapshotId = snapshot.id;
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createRun(completed: boolean): Promise<string> {
    const run = await createAgentRun(
      testDb.client.sql,
      agentTaskId,
      { ...executionPolicy, contextSnapshotId: snapshotId },
      actor,
    );
    if (completed) {
      await testDb.client.sql.unsafe(
        "update agent_runs set state = '完成' where id = $1",
        [run.id],
      );
    }
    return run.id;
  }

  function baseResult(): HarnessExecutionResult {
    return {
      visibleMessageSummary: "主分析完成",
      toolFacts: [],
      artifactRefs: ["artifact:table-1"],
      githubHints: [],
      scientificChangeProposals: [],
      stopReason: "completed",
      researchResult: {
        dataVersionRef: "data:v3",
        analysisRevisionId,
        executionKind: "manual",
        outputRefs: ["artifact:table-1"],
      },
    };
  }

  it("creates an immutable ResearchResult only for a completed Run", async () => {
    const runId = await createRun(true);
    const result = await ingestAgentResult(testDb.client.sql, runId, baseResult());
    expect(result.researchResultId).toBeTruthy();

    const rows = await testDb.client.sql.unsafe(
      "select run_ref, data_version_ref, analysis_revision_id from research_results where id = $1",
      [result.researchResultId],
    );
    expect(rows[0]).toMatchObject({
      run_ref: runId,
      data_version_ref: "data:v3",
      analysis_revision_id: analysisRevisionId,
    });
  });

  it("is idempotent for the same completed output and rejects a different replay", async () => {
    const runId = await createRun(true);
    const output = baseResult();
    const first = await ingestAgentResult(testDb.client.sql, runId, output);
    const second = await ingestAgentResult(testDb.client.sql, runId, output);
    expect(second).toEqual(first);

    const artifacts = await testDb.client.sql.unsafe(
      "select id from agent_run_artifacts where run_id = $1",
      [runId],
    );
    expect(artifacts).toHaveLength(2);

    await expect(
      ingestAgentResult(testDb.client.sql, runId, {
        ...output,
        visibleMessageSummary: "不同的重放内容",
      }),
    ).rejects.toThrow(/already committed|different output/i);
  });

  it("rejects a code result without an immutable Git commit locator", async () => {
    const runId = await createRun(true);
    const result = baseResult();
    result.researchResult = {
      ...result.researchResult!,
      executionKind: "code",
    };

    await expect(
      ingestAgentResult(testDb.client.sql, runId, result),
    ).rejects.toThrow(/Git commit|commit/i);
  });

  it("maps AI scientific changes to proposed decisions without changing official state", async () => {
    const runId = await createRun(true);
    const result = baseResult();
    result.researchResult = undefined;
    result.scientificChangeProposals = [
      {
        title: "变更正式理论",
        reason: "新证据支持修订机制",
        evidence: [{ kind: "result", ref: "agent-output" }],
        impact: ["正式理论"],
        change: {
          kind: "official_revision",
          slot: "正式理论",
          revisionId: theoryRevisionId,
        },
      },
    ];

    const ingested = await ingestAgentResult(testDb.client.sql, runId, result);
    expect(ingested.decisionIds).toHaveLength(1);

    const decisions = await testDb.client.sql.unsafe(
      "select status, proposed_by_type, target_revision_id from scientific_decisions where id = $1",
      [ingested.decisionIds[0]],
    );
    expect(decisions[0]).toMatchObject({
      status: "proposed",
      proposed_by_type: "agent",
      target_revision_id: theoryRevisionId,
    });

    const official = await testDb.client.sql.unsafe(
      "select revision_id from official_revisions where project_id = $1 and slot = '正式理论'",
      [projectId],
    );
    expect(official).toHaveLength(0);
  });

  it("rejects secret-shaped output before creating results, decisions or events", async () => {
    const runId = await createRun(true);
    const beforeEvents = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1",
      [projectId],
    );
    const unsafe = {
      ...baseResult(),
      token: "must-not-persist",
    } as HarnessExecutionResult;

    await expect(
      ingestAgentResult(testDb.client.sql, runId, unsafe),
    ).rejects.toThrow(/Sensitive credential|secret|credential/i);

    const afterEvents = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where project_id = $1",
      [projectId],
    );
    expect(afterEvents[0]?.count).toBe(beforeEvents[0]?.count);
  });

  it("rejects ingestion when the Run has not completed", async () => {
    const runId = await createRun(false);
    await expect(
      ingestAgentResult(testDb.client.sql, runId, baseResult()),
    ).rejects.toThrow(/completed|完成/i);
  });
});
