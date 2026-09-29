import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import { createResearchTask } from "../../packages/application/src/tasks/research-task-service";
import { createAgentTask } from "../../packages/application/src/agents/create-agent-task";
import { createAgentRun } from "../../packages/application/src/agents/create-agent-run";
import { buildAgentContextSnapshot } from "../../packages/application/src/agents/context-snapshot";
import {
  answerHumanInteraction,
  issueAgentCallbackCredential,
  requestHumanInteraction,
  verifyAgentCallbackCredential,
} from "../../packages/application/src/agents/human-interaction";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("durable Agent human interaction", () => {
  let testDb: TestDatabase;
  const projectId = "human-interaction-project";
  const leadId = "human-interaction-lead";
  const actor = { type: "human" as const, id: leadId };
  let runId: string;
  let credentialRef: string;
  let callbackToken: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('human-interaction-team', 'Human Interaction Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ($1, 'human-interaction-team', 'lead@human-interaction.test', 'Lead', 'lead', 'human')",
      [leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('human-interaction-portfolio', 'human-interaction-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'human-interaction-portfolio', 'Human Interaction Project', $2)",
      [projectId, leadId],
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('human-interaction-membership', $1, $2, 'lead')",
      [projectId, leadId],
    );

    const researchTask = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "需要人工判断的智能诊断" },
      actor,
    );
    const agentTask = await createAgentTask(
      testDb.client.sql,
      researchTask.id,
      { objective: "诊断并在必要时询问研究者" },
      actor,
    );
    const snapshot = await buildAgentContextSnapshot(
      testDb.client.sql,
      projectId,
      {
        researchQuestionRevisionId: null,
        theoryRevisionId: null,
        researchDesignRevisionId: null,
        dataVersionRef: "data:v1",
        assetVersionRefs: [],
        gitBaseCommit: null,
        skillVersionRefs: [],
        harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
        harnessProfile: "sdk",
        runtimeProfile: "research-execution",
        modelRoute: "deepseek-official/deepseek-v4-flash",
        sandboxPolicy: "workspace-write",
        toolAllowlist: ["read_file"],
        subagentAllowlist: [],
      },
      actor,
    );
    const run = await createAgentRun(
      testDb.client.sql,
      agentTask.id,
      {
        contextSnapshotId: snapshot.id,
        gitBaseCommit: null,
        skillVersionRefs: [],
        harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
        harnessProfile: "sdk",
        runtimeProfile: "research-execution",
        modelRoute: "deepseek-official/deepseek-v4-flash",
        sandboxPolicy: "workspace-write",
        toolAllowlist: ["read_file"],
        subagentAllowlist: [],
      },
      actor,
    );
    runId = run.id;
    await testDb.client.sql.unsafe(
      "update agent_runs set state = '执行中' where id = $1",
      [runId],
    );

    const issued = await issueAgentCallbackCredential(
      testDb.client.sql,
      runId,
      "test-signing-secret",
      600,
    );
    credentialRef = issued.credentialRef;
    callbackToken = issued.token;
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("stores only a callback credential reference and verifies the signed token", async () => {
    expect(callbackToken).not.toBe(credentialRef);

    await expect(
      verifyAgentCallbackCredential(
        testDb.client.sql,
        callbackToken,
        "test-signing-secret",
        runId,
      ),
    ).resolves.toMatchObject({
      runId,
      credentialRef,
    });

    await expect(
      verifyAgentCallbackCredential(
        testDb.client.sql,
        callbackToken + "tampered",
        "test-signing-secret",
        runId,
      ),
    ).rejects.toThrow(/credential|signature|token/i);

    const rows = await testDb.client.sql.unsafe(
      "select id, run_id from agent_callback_credentials where id = $1",
      [credentialRef],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(callbackToken);

    const eventRows = await testDb.client.sql.unsafe(
      "select payload from research_events where project_id = $1",
      [projectId],
    );
    expect(JSON.stringify(eventRows)).not.toContain(callbackToken);
  });

  it("persists a pending question across service calls and puts the Run into waiting_human", async () => {
    const first = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "question",
        payload: {
          questions: [{ id: "confirm", question: "继续吗？" }],
        },
        nonce: "question-nonce-1",
        credentialRef,
      },
    );
    expect(first).toMatchObject({
      status: "pending",
      interactionId: expect.any(String),
    });

    const runRows = await testDb.client.sql.unsafe(
      "select state from agent_runs where id = $1",
      [runId],
    );
    expect(runRows[0]?.state).toBe("等待人工输入");

    const afterRestartEquivalent = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "question",
        payload: {
          questions: [{ id: "confirm", question: "继续吗？" }],
        },
        nonce: "question-nonce-1",
        credentialRef,
      },
    );
    expect(afterRestartEquivalent).toEqual(first);

    const rows = await testDb.client.sql.unsafe(
      "select state, nonce from agent_human_interactions where run_id = $1 and nonce = $2",
      [runId, "question-nonce-1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("pending");
  });

  it("returns the persisted human answer and restores a live Run to executing", async () => {
    const pending = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "question",
        payload: {
          questions: [{ id: "confirm", question: "继续吗？" }],
        },
        nonce: "question-nonce-1",
        credentialRef,
      },
    );

    await answerHumanInteraction(
      testDb.client.sql,
      pending.interactionId,
      {
        answers: [{ id: "confirm", selected: ["继续"] }],
      },
      actor,
    );

    const answered = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "question",
        payload: {
          questions: [{ id: "confirm", question: "继续吗？" }],
        },
        nonce: "question-nonce-1",
        credentialRef,
      },
    );

    expect(answered).toMatchObject({
      status: "answered",
      answer: {
        answers: [{ id: "confirm", selected: ["继续"] }],
      },
    });
    const runRows = await testDb.client.sql.unsafe(
      "select state from agent_runs where id = $1",
      [runId],
    );
    expect(runRows[0]?.state).toBe("执行中");
  });

  it("keeps execution approval one-shot and refuses a second answer", async () => {
    await testDb.client.sql.unsafe(
      "update agent_runs set state = '执行中' where id = $1",
      [runId],
    );
    const pending = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "approval",
        payload: {
          toolName: "bash",
          reason: "run a controlled diagnostic command",
        },
        nonce: "approval-nonce-1",
        credentialRef,
      },
    );

    await answerHumanInteraction(
      testDb.client.sql,
      pending.interactionId,
      "allowed-once",
      actor,
    );

    await expect(
      answerHumanInteraction(
        testDb.client.sql,
        pending.interactionId,
        "allowed-once",
        actor,
      ),
    ).rejects.toThrow(/already|answered|one-shot/i);
  });

  it("never supplies a default approval while the human has not answered", async () => {
    await testDb.client.sql.unsafe(
      "update agent_runs set state = '执行中' where id = $1",
      [runId],
    );
    const pending = await requestHumanInteraction(
      testDb.client.sql,
      {
        runId,
        kind: "approval",
        payload: { toolName: "write", reason: "modify workspace" },
        nonce: "approval-nonce-pending",
        credentialRef,
      },
    );

    expect(pending).toMatchObject({ status: "pending" });
    expect("answer" in pending).toBe(false);
  });
});
