import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type {
  AgentExecutionPolicy,
  AgentRun,
  CreateAgentRunPolicy,
} from "@research-workbench/domain/src/agent-runtime";
import { assertSecretSafe, type JsonValue } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { runInTransaction } from "../transactions";

type AgentTaskContext = { project_id: string };

function executionPolicyWithoutSnapshot(input: CreateAgentRunPolicy): AgentExecutionPolicy {
  return {
    sandboxPolicy: input.sandboxPolicy,
    toolAllowlist: input.toolAllowlist,
    subagentAllowlist: input.subagentAllowlist,
    runtimeProfile: input.runtimeProfile,
    harnessVersion: input.harnessVersion,
    harnessProfile: input.harnessProfile,
    modelRoute: input.modelRoute,
    skillVersionRefs: input.skillVersionRefs,
    gitBaseCommit: input.gitBaseCommit,
  };
}

export async function createAgentRun(
  sql: DatabaseSql,
  agentTaskId: string,
  input: CreateAgentRunPolicy,
  actor: ActorRef,
): Promise<AgentRun> {
  const executionPolicy = executionPolicyWithoutSnapshot(input);
  assertSecretSafe(executionPolicy as unknown as JsonValue);

  const taskRows = (await sql.unsafe(
    "select project_id from agent_tasks where id = $1 limit 1",
    [agentTaskId],
  )) as readonly AgentTaskContext[];
  const task = taskRows[0];
  if (!task) throw new Error("Agent task not found");

  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, task.project_id, "read");
  } else if (actor.type === "agent") {
    throw new Error("Agent actors cannot create AgentRun attempts directly");
  }

  if (input.contextSnapshotId) {
    const snapshots = await sql.unsafe(
      "select 1 from agent_context_snapshots where id = $1 and project_id = $2 limit 1",
      [input.contextSnapshotId, task.project_id],
    );
    if (snapshots.length === 0) {
      throw new Error("Agent context snapshot does not belong to the AgentTask project");
    }
  }

  return runInTransaction(sql, async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))", [agentTaskId]);
    const attemptRows = await tx.unsafe(
      "select coalesce(max(attempt_number), 0)::int + 1 as next_attempt from agent_runs where agent_task_id = $1",
      [agentTaskId],
    );
    const attemptNumber = Number(attemptRows[0]?.next_attempt ?? 1);
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into agent_runs
        (id, agent_task_id, project_id, attempt_number, context_snapshot_id,
         state, execution_policy, failure_code, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, '已提议', $6::jsonb, null, $7, $8)
       returning created_at, updated_at`,
      [
        id,
        agentTaskId,
        task.project_id,
        attemptNumber,
        input.contextSnapshotId,
        JSON.stringify(executionPolicy),
        actor.type,
        actor.id,
      ],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: task.project_id,
      eventType: "AGENT_RUN_CREATED",
      actor,
      payload: { agentRunId: id, agentTaskId, attemptNumber },
    });

    const row = rows[0];
    if (!row) throw new Error("Agent run insert returned no row");
    return {
      id,
      agentTaskId,
      projectId: task.project_id,
      attemptNumber,
      contextSnapshotId: input.contextSnapshotId,
      state: "已提议",
      executionPolicy,
      failureCode: null,
      createdBy: actor,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  });
}
