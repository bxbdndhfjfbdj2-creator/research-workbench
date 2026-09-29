import type { DatabaseSql } from "@research-workbench/db/src/client";

export type ProjectAction = "read" | "write" | "file_write";

type AccessRow = {
  organization_role: "lead" | "researcher";
  membership_id: string | null;
  membership_role: string | null;
};

export async function authorizeProjectAccess(
  sql: DatabaseSql,
  actorId: string,
  projectId: string,
  action: ProjectAction,
): Promise<void> {
  const rows = (await sql.unsafe(
    `select
       m.organization_role,
       pm.id as membership_id,
       pm.role as membership_role
     from members m
     join research_projects p on p.id = $2
     join research_portfolios rp on rp.id = p.portfolio_id and rp.team_id = m.team_id
     left join project_memberships pm
       on pm.project_id = p.id and pm.member_id = m.id
     where m.id = $1
       and m.actor_type = 'human'
       and m.active = true
     limit 1`,
    [actorId, projectId],
  )) as readonly AccessRow[];

  const access = rows[0];
  if (!access) throw new Error("Forbidden: actor cannot access this project");

  if (access.organization_role === "lead") return;
  if (!access.membership_id) {
    throw new Error("Forbidden: actor is not a member of this project");
  }

  if (action === "read") return;
  if (action === "file_write" && ["lead", "collaborator"].includes(access.membership_role ?? "")) {
    return;
  }
  if (action === "write" && access.membership_role === "lead") return;

  if (action === "file_write") {
    throw new Error("Forbidden: this project role cannot modify research files");
  }
  throw new Error("Forbidden: only the team lead or project lead may modify formal project state");
}
