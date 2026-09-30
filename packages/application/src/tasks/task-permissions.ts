import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { TransactionSql } from "../transactions";

type TaskPermissionSql = Pick<DatabaseSql, "unsafe">;

type ProjectAccessRow = {
  organization_role: string;
  lead_member_id: string;
  membership_id: string | null;
  membership_role: string | null;
};

async function loadProjectAccess(
  sql: TaskPermissionSql,
  projectId: string,
  memberId: string,
): Promise<ProjectAccessRow | null> {
  const rows = (await sql.unsafe(
    `select
       m.organization_role,
       p.lead_member_id,
       pm.id as membership_id,
       pm.role as membership_role
     from research_projects p
     join research_portfolios rp on rp.id = p.portfolio_id
     join members m
       on m.id = $2
      and m.team_id = rp.team_id
      and m.actor_type = 'human'
      and m.active = true
     left join project_memberships pm
       on pm.project_id = p.id
      and pm.member_id = m.id
     where p.id = $1
     limit 1`,
    [projectId, memberId],
  )) as readonly ProjectAccessRow[];
  return rows[0] ?? null;
}

function hasProjectAccess(access: ProjectAccessRow, memberId: string): boolean {
  return (
    access.organization_role === "lead" ||
    access.lead_member_id === memberId ||
    access.membership_id !== null
  );
}

function isProjectOrTeamLead(access: ProjectAccessRow, memberId: string): boolean {
  return (
    access.organization_role === "lead" ||
    access.lead_member_id === memberId ||
    access.membership_role === "lead"
  );
}

export async function assertTaskProjectAccess(
  sql: TaskPermissionSql,
  projectId: string,
  memberId: string,
): Promise<void> {
  const access = await loadProjectAccess(sql, projectId, memberId);
  if (!access || !hasProjectAccess(access, memberId)) {
    throw new Error("Forbidden: actor cannot access this project");
  }
}

export async function assertEligibleTaskOwner(
  sql: TaskPermissionSql,
  projectId: string,
  memberId: string,
): Promise<void> {
  const access = await loadProjectAccess(sql, projectId, memberId);
  if (!access || !hasProjectAccess(access, memberId)) {
    throw new Error(
      "Task owner must be an active human with access to the project",
    );
  }
}

export async function assertProjectOrTeamLead(
  sql: TaskPermissionSql,
  projectId: string,
  memberId: string,
): Promise<void> {
  const access = await loadProjectAccess(sql, projectId, memberId);
  if (
    !access ||
    !hasProjectAccess(access, memberId) ||
    !isProjectOrTeamLead(access, memberId)
  ) {
    throw new Error("Forbidden: only the project or team lead may perform this action");
  }
}

export async function assertTaskOwnerOrLead(
  sql: TaskPermissionSql,
  projectId: string,
  ownerMemberId: string,
  actorMemberId: string,
): Promise<void> {
  const access = await loadProjectAccess(sql, projectId, actorMemberId);
  if (!access || !hasProjectAccess(access, actorMemberId)) {
    throw new Error("Forbidden: actor cannot access this project");
  }
  if (
    actorMemberId !== ownerMemberId &&
    !isProjectOrTeamLead(access, actorMemberId)
  ) {
    throw new Error("Forbidden: task owner or project/team lead required");
  }
}

export async function assertAccountableTaskOwner(
  sql: TaskPermissionSql,
  projectId: string,
  ownerMemberId: string,
  actorMemberId: string,
): Promise<void> {
  const access = await loadProjectAccess(sql, projectId, actorMemberId);
  if (
    !access ||
    !hasProjectAccess(access, actorMemberId) ||
    actorMemberId !== ownerMemberId
  ) {
    throw new Error("Forbidden: accountable task owner required");
  }
}


export async function assertEligibleReviewer(
  tx: TransactionSql,
  projectId: string,
  submissionId: string,
  reviewerMemberId: string,
): Promise<void> {
  const access = await loadProjectAccess(tx, projectId, reviewerMemberId);
  if (!access || !hasProjectAccess(access, reviewerMemberId)) {
    throw new Error("Reviewer must be an active human with access to the project");
  }

  const conflicts = await tx.unsafe(
    `select 1
     from task_submission_contributors
     where submission_id = $1
       and contributor_kind = 'human_member'
       and contributor_ref = $2
     limit 1`,
    [submissionId, reviewerMemberId],
  );
  if (conflicts.length > 0) {
    throw new Error("Reviewer cannot review a submission they contributed to");
  }
}
