import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import {
  RESEARCH_TASK_STATUSES,
  type ResearchTask,
  type ResearchTaskStatus,
} from "@research-workbench/domain/src/research-task";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: ResearchTaskStatus;
  assignee_member_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

function toTask(row: TaskRow): ResearchTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeMemberId: row.assignee_member_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadTask(sql: DatabaseSql, taskId: string): Promise<TaskRow> {
  const rows = (await sql.unsafe(
    `select id, project_id, title, description, status, assignee_member_id,
            created_by, created_at, updated_at
     from research_tasks where id = $1 limit 1`,
    [taskId],
  )) as readonly TaskRow[];
  const row = rows[0];
  if (!row) throw new Error("Research task not found");
  return row;
}

async function assertAssignableMember(
  sql: DatabaseSql,
  projectId: string,
  memberId: string,
): Promise<void> {
  const rows = await sql.unsafe(
    `select 1
     from research_projects p
     join research_portfolios rp on rp.id = p.portfolio_id
     join members m on m.id = $2 and m.team_id = rp.team_id and m.active = true
     left join project_memberships pm on pm.project_id = p.id and pm.member_id = m.id
     where p.id = $1
       and (m.organization_role = 'lead' or pm.id is not null)
     limit 1`,
    [projectId, memberId],
  );
  if (rows.length === 0) throw new Error("Assignee must have access to the project");
}

export async function createResearchTask(
  sql: DatabaseSql,
  projectId: string,
  input: { title: string; description?: string | null; assigneeMemberId?: string | null },
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  await authorizeProjectAccess(sql, actor.id, projectId, "read");

  if (input.assigneeMemberId) {
    await assertAssignableMember(sql, projectId, input.assigneeMemberId);
  }

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = (await tx.unsafe(
      `insert into research_tasks
        (id, project_id, title, description, status, assignee_member_id, created_by)
       values ($1, $2, $3, $4, 'open', $5, $6)
       returning id, project_id, title, description, status, assignee_member_id,
                 created_by, created_at, updated_at`,
      [
        id,
        projectId,
        input.title.trim(),
        input.description?.trim() || null,
        input.assigneeMemberId ?? null,
        actor.id,
      ],
    )) as readonly TaskRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_TASK_CREATED",
      actor,
      payload: {
        researchTaskId: id,
        title: input.title.trim(),
        assigneeMemberId: input.assigneeMemberId ?? null,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.created",
      payload: { projectId, researchTaskId: id },
    });

    const row = rows[0];
    if (!row) throw new Error("Research task insert returned no row");
    return toTask(row);
  });
}

export async function assignResearchTask(
  sql: DatabaseSql,
  taskId: string,
  memberId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  const existing = await loadTask(sql, taskId);
  await authorizeProjectAccess(sql, actor.id, existing.project_id, "read");
  await assertAssignableMember(sql, existing.project_id, memberId);

  return runInTransaction(sql, async (tx) => {
    const rows = (await tx.unsafe(
      `update research_tasks
       set assignee_member_id = $2, updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 created_by, created_at, updated_at`,
      [taskId, memberId],
    )) as readonly TaskRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: existing.project_id,
      eventType: "RESEARCH_TASK_ASSIGNED",
      actor,
      payload: { researchTaskId: taskId, memberId },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.assigned",
      payload: { projectId: existing.project_id, researchTaskId: taskId, memberId },
    });

    const row = rows[0];
    if (!row) throw new Error("Research task update returned no row");
    return toTask(row);
  });
}

export async function setResearchTaskStatus(
  sql: DatabaseSql,
  taskId: string,
  status: ResearchTaskStatus,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  if (!RESEARCH_TASK_STATUSES.includes(status)) {
    throw new Error("Unsupported research task status");
  }

  const existing = await loadTask(sql, taskId);
  await authorizeProjectAccess(sql, actor.id, existing.project_id, "read");

  return runInTransaction(sql, async (tx) => {
    const rows = (await tx.unsafe(
      `update research_tasks
       set status = $2, updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 created_by, created_at, updated_at`,
      [taskId, status],
    )) as readonly TaskRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: existing.project_id,
      eventType: "RESEARCH_TASK_STATUS_CHANGED",
      actor,
      payload: { researchTaskId: taskId, status },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.status.changed",
      payload: { projectId: existing.project_id, researchTaskId: taskId, status },
    });

    const row = rows[0];
    if (!row) throw new Error("Research task update returned no row");
    return toTask(row);
  });
}
