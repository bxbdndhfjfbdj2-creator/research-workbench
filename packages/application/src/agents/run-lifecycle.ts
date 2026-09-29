import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type { AgentRunState } from "@research-workbench/domain/src/agent-runtime";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

export type RunStateDetails = {
  actor: ActorRef;
  failureCode?: string | null;
  enqueueDispatch?: boolean;
};

const EVENT_BY_STATE: Partial<Record<AgentRunState, string>> = {
  "等待授权": "AGENT_RUN_AUTHORIZATION_REQUIRED",
  "排队": "AGENT_RUN_QUEUED",
  "已派发": "AGENT_RUN_DISPATCHED",
  "执行中": "AGENT_RUN_STARTED",
  "等待人工输入": "AGENT_RUN_WAITING_HUMAN",
  "继续执行": "AGENT_RUN_RESUMED",
  "完成": "AGENT_RUN_COMPLETED",
  "失败": "AGENT_RUN_FAILED",
  "取消": "AGENT_RUN_CANCELLED",
  "被替代": "AGENT_RUN_SUPERSEDED",
};

export async function markRunState(
  sql: DatabaseSql,
  runId: string,
  expectedState: AgentRunState,
  nextState: AgentRunState,
  details: RunStateDetails,
): Promise<boolean> {
  return runInTransaction(sql, async (tx) => {
    const rows = await tx.unsafe(
      `update agent_runs
       set state = $3,
           failure_code = $4,
           updated_at = now()
       where id = $1 and state = $2
       returning project_id, agent_task_id`,
      [runId, expectedState, nextState, details.failureCode ?? null],
    );
    const row = rows[0];
    if (!row) return false;

    const eventType = EVENT_BY_STATE[nextState];
    if (eventType) {
      await appendResearchEvent(tx, {
        id: randomUUID(),
        projectId: String(row.project_id),
        eventType,
        actor: details.actor,
        payload: {
          agentRunId: runId,
          agentTaskId: String(row.agent_task_id),
          fromState: expectedState,
          toState: nextState,
          failureCode: details.failureCode ?? null,
        },
      });
    }

    if (details.enqueueDispatch) {
      await enqueueOutbox(tx, {
        id: randomUUID(),
        eventType: "agent.run.dispatch",
        payload: {
          projectId: String(row.project_id),
          agentRunId: runId,
        },
      });
    }
    return true;
  });
}

export async function queueAgentRun(
  sql: DatabaseSql,
  runId: string,
  actor: ActorRef,
): Promise<void> {
  const rows = await sql.unsafe(
    `select r.project_id, r.context_snapshot_id, r.state
     from agent_runs r
     where r.id = $1
     limit 1`,
    [runId],
  );
  const run = rows[0];
  if (!run) throw new Error("Agent run not found");
  if (!run.context_snapshot_id) {
    throw new Error("Agent run requires a context snapshot before queueing");
  }

  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, String(run.project_id), "read");
  } else if (actor.type === "agent") {
    throw new Error("Agent actors cannot authorize AgentRun queueing");
  }

  const current = String(run.state) as AgentRunState;
  if (current !== "已提议" && current !== "等待授权") {
    throw new Error(`Agent run cannot be queued from state ${current}`);
  }

  const changed = await markRunState(sql, runId, current, "排队", {
    actor,
    enqueueDispatch: true,
  });
  if (!changed) {
    throw new Error("Agent run state changed before queueing");
  }
}
