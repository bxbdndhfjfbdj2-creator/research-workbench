import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

export const PROJECT_MEMBERSHIP_ROLES = [
  "lead",
  "collaborator",
  "method_challenger",
  "theory_replication_challenger",
  "observer",
] as const;

export type ProjectMembershipRole = (typeof PROJECT_MEMBERSHIP_ROLES)[number];

export type ProjectMembership = {
  id: string;
  projectId: string;
  memberId: string;
  role: ProjectMembershipRole;
  createdAt: Date;
};

type MembershipRow = {
  id: string;
  project_id: string;
  member_id: string;
  role: ProjectMembershipRole;
  created_at: Date;
};

export async function setProjectMembership(
  sql: DatabaseSql,
  projectId: string,
  memberId: string,
  role: ProjectMembershipRole,
  actor: ActorRef,
): Promise<ProjectMembership> {
  assertHumanActor(actor);
  await authorizeProjectAccess(sql, actor.id, projectId, "write");

  const eligible = await sql.unsafe(
    `select 1
     from research_projects p
     join research_portfolios rp on rp.id = p.portfolio_id
     join members m on m.id = $2 and m.team_id = rp.team_id
     where p.id = $1 and m.active = true and m.actor_type = 'human'
     limit 1`,
    [projectId, memberId],
  );
  if (eligible.length === 0) throw new Error("Member must belong to the project team");

  return runInTransaction(sql, async (tx) => {
    const rows = (await tx.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ($1, $2, $3, $4)
       on conflict (project_id, member_id)
       do update set role = excluded.role
       returning id, project_id, member_id, role, created_at`,
      [randomUUID(), projectId, memberId, role],
    )) as readonly MembershipRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "PROJECT_MEMBERSHIP_CHANGED",
      actor,
      payload: { memberId, role },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "project.membership.changed",
      payload: { projectId, memberId, role },
    });

    const row = rows[0];
    if (!row) throw new Error("Project membership upsert returned no row");
    return {
      id: row.id,
      projectId: row.project_id,
      memberId: row.member_id,
      role: row.role,
      createdAt: row.created_at,
    };
  });
}
