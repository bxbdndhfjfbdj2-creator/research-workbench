"use server";

import { revalidatePath } from "next/cache";
import { authorizeProjectAccess } from "@research-workbench/application/src/auth/authorize";
import { createAgentTask } from "@research-workbench/application/src/agents/create-agent-task";
import { createAgentRun } from "@research-workbench/application/src/agents/create-agent-run";
import { buildAgentContextSnapshot } from "@research-workbench/application/src/agents/context-snapshot";
import { answerHumanInteraction } from "@research-workbench/application/src/agents/human-interaction";
import { queueAgentRun } from "@research-workbench/application/src/agents/run-lifecycle";
import type { AgentExecutionPolicy } from "@research-workbench/domain/src/agent-runtime";
import {
  getWebDbClient,
  requireCurrentMember,
} from "./queries";

const PINNED_HARNESS_VERSION =
  "4878cdabd87d4041bdaff61d04c966883b9fd07a";

function requiredText(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function revalidateAgentWork(projectId: string) {
  revalidatePath("/agent-work");
  revalidatePath(`/projects/${projectId}/agent-work`);
}

export async function createAgentWorkAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const projectId = requiredText(formData, "projectId");
  const researchTaskId = requiredText(formData, "researchTaskId");
  const objective = requiredText(formData, "objective");
  const expectedOutput = requiredText(formData, "expectedOutput");
  const db = getWebDbClient();

  await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  const taskRows = await db.sql.unsafe(
    "select 1 from research_tasks where id = $1 and project_id = $2 limit 1",
    [researchTaskId, projectId],
  );
  if (taskRows.length === 0) throw new Error("Research task does not belong to this project");

  const officialRows = await db.sql.unsafe(
    "select slot, revision_id from official_revisions where project_id = $1",
    [projectId],
  );
  const official = new Map(
    officialRows.map((row) => [String(row.slot), String(row.revision_id)]),
  );
  const latestResultRows = await db.sql.unsafe(
    `select data_version_ref, git_commit_sha
     from research_results
     where project_id = $1
     order by created_at desc
     limit 1`,
    [projectId],
  );
  const latestResult = latestResultRows[0];

  const executionPolicy: AgentExecutionPolicy = {
    sandboxPolicy: "read-only",
    toolAllowlist: ["read_file", "search_files"],
    subagentAllowlist: [],
    runtimeProfile: "research-execution",
    harnessVersion: process.env.RW_HARNESS_VERSION ?? PINNED_HARNESS_VERSION,
    harnessProfile: "sdk",
    modelRoute:
      process.env.RW_HARNESS_MODEL_ROUTE ??
      "deepseek-official/deepseek-v4-flash",
    skillVersionRefs: [],
    gitBaseCommit: latestResult?.git_commit_sha
      ? String(latestResult.git_commit_sha)
      : null,
  };

  const actor = { type: "human" as const, id: member.id };
  const agentTask = await createAgentTask(
    db.sql,
    researchTaskId,
    { objective, expectedOutput },
    actor,
  );
  const snapshot = await buildAgentContextSnapshot(
    db.sql,
    projectId,
    {
      researchQuestionRevisionId: official.get("核心研究问题") ?? null,
      theoryRevisionId: official.get("正式理论") ?? null,
      researchDesignRevisionId: null,
      dataVersionRef: latestResult?.data_version_ref
        ? String(latestResult.data_version_ref)
        : null,
      assetVersionRefs: [],
      ...executionPolicy,
    },
    actor,
  );
  await createAgentRun(
    db.sql,
    agentTask.id,
    { ...executionPolicy, contextSnapshotId: snapshot.id },
    actor,
  );
  revalidateAgentWork(projectId);
}


export async function queueAgentRunAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const runId = requiredText(formData, "runId");
  const projectId = requiredText(formData, "projectId");
  const db = getWebDbClient();

  const rows = await db.sql.unsafe(
    "select project_id from agent_runs where id = $1 limit 1",
    [runId],
  );
  const run = rows[0];
  if (!run || String(run.project_id) !== projectId) {
    throw new Error("Agent run not found");
  }

  await queueAgentRun(
    db.sql,
    runId,
    { type: "human", id: member.id },
  );
  revalidateAgentWork(projectId);
}

export async function retryAgentRunAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const runId = requiredText(formData, "runId");
  const projectId = requiredText(formData, "projectId");
  const db = getWebDbClient();
  await authorizeProjectAccess(db.sql, member.id, projectId, "read");

  const rows = await db.sql.unsafe(
    `select agent_task_id, project_id, context_snapshot_id, execution_policy, state
     from agent_runs
     where id = $1
     limit 1`,
    [runId],
  );
  const run = rows[0];
  if (!run || String(run.project_id) !== projectId) throw new Error("Agent run not found");
  if (!["失败", "取消", "被替代"].includes(String(run.state))) {
    throw new Error("Only a terminal unsuccessful Run can be retried");
  }
  if (!run.context_snapshot_id) throw new Error("Agent run has no frozen context");

  const policy = run.execution_policy as AgentExecutionPolicy;
  await createAgentRun(
    db.sql,
    String(run.agent_task_id),
    {
      ...policy,
      contextSnapshotId: String(run.context_snapshot_id),
    },
    { type: "human", id: member.id },
  );
  revalidateAgentWork(projectId);
}

export async function answerAgentQuestionAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const interactionId = requiredText(formData, "interactionId");
  const projectId = requiredText(formData, "projectId");
  const questionId = requiredText(formData, "questionId");
  const answer = requiredText(formData, "answer");
  await answerHumanInteraction(
    getWebDbClient().sql,
    interactionId,
    { answers: [{ id: questionId, selected: [answer] }] },
    { type: "human", id: member.id },
  );
  revalidateAgentWork(projectId);
}

export async function answerAgentApprovalAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const interactionId = requiredText(formData, "interactionId");
  const projectId = requiredText(formData, "projectId");
  const answer = requiredText(formData, "answer");
  if (!["allowed-once", "rejected"].includes(answer)) {
    throw new Error("Invalid approval response");
  }
  await answerHumanInteraction(
    getWebDbClient().sql,
    interactionId,
    answer,
    { type: "human", id: member.id },
  );
  revalidateAgentWork(projectId);
}
