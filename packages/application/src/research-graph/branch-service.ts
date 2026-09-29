import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type { ResearchBranch } from "@research-workbench/domain/src/research-graph";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

async function authorizeBranchActor(sql: DatabaseSql, projectId: string, actor: ActorRef) {
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "write");
    return;
  }
  throw new Error("Only human actors may change research branch lifecycle");
}

function toBranch(row: Record<string, unknown>): ResearchBranch {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    originNodeId: String(row.origin_node_id),
    status: row.status as "open" | "closed",
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createResearchBranch(
  sql: DatabaseSql,
  projectId: string,
  name: string,
  originNodeId: string,
  actor: ActorRef,
): Promise<ResearchBranch> {
  await authorizeBranchActor(sql, projectId, actor);
  const originRows = await sql.unsafe(
    "select 1 from research_nodes where id = $1 and project_id = $2 limit 1",
    [originNodeId, projectId],
  );
  if (originRows.length === 0) throw new Error("Origin node must belong to the project");

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into research_branches (id, project_id, name, origin_node_id, status)
       values ($1, $2, $3, $4, 'open')
       returning id, project_id, name, origin_node_id, status, created_at, updated_at`,
      [id, projectId, name.trim(), originNodeId],
    );
    await tx.unsafe(
      `insert into research_branch_history
        (id, branch_id, action, reason, actor_type, actor_id)
       values ($1, $2, 'created', null, $3, $4)`,
      [randomUUID(), id, actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_BRANCH_CREATED",
      actor,
      payload: { branchId: id, name: name.trim(), originNodeId },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.branch.created",
      payload: { projectId, branchId: id },
    });
    const row = rows[0];
    if (!row) throw new Error("Research branch insert returned no row");
    return toBranch(row as Record<string, unknown>);
  });
}

async function loadBranchForUpdate(sql: DatabaseSql, branchId: string) {
  const rows = await sql.unsafe(
    "select id, project_id, name, origin_node_id, status, created_at, updated_at from research_branches where id = $1 limit 1",
    [branchId],
  );
  const row = rows[0];
  if (!row) throw new Error("Research branch not found");
  return row;
}

export async function closeResearchBranch(
  sql: DatabaseSql,
  branchId: string,
  reason: string,
  actor: ActorRef,
): Promise<void> {
  const branch = await loadBranchForUpdate(sql, branchId);
  const projectId = String(branch.project_id);
  await authorizeBranchActor(sql, projectId, actor);

  await runInTransaction(sql, async (tx) => {
    const locked = await tx.unsafe(
      "select status from research_branches where id = $1 for update",
      [branchId],
    );
    if (locked[0]?.status === "closed") throw new Error("Research branch is already closed");
    await tx.unsafe(
      "update research_branches set status = 'closed', updated_at = now() where id = $1",
      [branchId],
    );
    await tx.unsafe(
      `insert into research_branch_history
        (id, branch_id, action, reason, actor_type, actor_id)
       values ($1, $2, 'closed', $3, $4, $5)`,
      [randomUUID(), branchId, reason.trim(), actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_BRANCH_CLOSED",
      actor,
      payload: { branchId, reason: reason.trim() },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.branch.closed",
      payload: { projectId, branchId },
    });
  });
}

export async function reopenResearchBranch(
  sql: DatabaseSql,
  branchId: string,
  actor: ActorRef,
): Promise<void> {
  const branch = await loadBranchForUpdate(sql, branchId);
  const projectId = String(branch.project_id);
  await authorizeBranchActor(sql, projectId, actor);

  await runInTransaction(sql, async (tx) => {
    const locked = await tx.unsafe(
      "select status from research_branches where id = $1 for update",
      [branchId],
    );
    if (locked[0]?.status !== "closed") throw new Error("Only closed research branches can be reopened");
    await tx.unsafe(
      "update research_branches set status = 'open', updated_at = now() where id = $1",
      [branchId],
    );
    await tx.unsafe(
      `insert into research_branch_history
        (id, branch_id, action, reason, actor_type, actor_id)
       values ($1, $2, 'reopened', null, $3, $4)`,
      [randomUUID(), branchId, actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_BRANCH_REOPENED",
      actor,
      payload: { branchId },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.branch.reopened",
      payload: { projectId, branchId },
    });
  });
}
