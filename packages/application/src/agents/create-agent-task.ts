import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type { AgentTask, AgentTaskRequest } from "@research-workbench/domain/src/agent-runtime";
import { assertSecretSafe } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

type TaskContextRow = { project_id: string };

export async function createAgentTask(
  sql: DatabaseSql,
  researchTaskId: string,
  request: AgentTaskRequest,
  actor: ActorRef,
): Promise<AgentTask> {
  assertSecretSafe(request);

  const contextRows = (await sql.unsafe(
    "select project_id from research_tasks where id = $1 limit 1",
    [researchTaskId],
  )) as readonly TaskContextRow[];
  const context = contextRows[0];
  if (!context) throw new Error("Research task not found");

  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, context.project_id, "read");
  } else if (actor.type === "agent") {
    throw new Error("Agent actors cannot create new AgentTask records directly");
  }

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into agent_tasks
        (id, research_task_id, project_id, request, created_by_type, created_by_id)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       returning id, research_task_id, project_id, request, created_at`,
      [id, researchTaskId, context.project_id, JSON.stringify(request), actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: context.project_id,
      eventType: "AGENT_TASK_CREATED",
      actor,
      payload: { agentTaskId: id, researchTaskId },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "agent.task.created",
      payload: { projectId: context.project_id, agentTaskId: id },
    });

    const row = rows[0];
    if (!row) throw new Error("Agent task insert returned no row");
    return {
      id: String(row.id),
      researchTaskId: String(row.research_task_id),
      projectId: String(row.project_id),
      request: row.request as AgentTaskRequest,
      createdBy: actor,
      createdAt: row.created_at as Date,
    };
  });
}
