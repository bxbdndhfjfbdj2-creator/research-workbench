import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeProjectAccess } from "@research-workbench/application/src/auth/authorize";
import { createDbClient } from "@research-workbench/db/src/client";
import { getWorkbenchAuth } from "../auth";

export type CurrentMember = {
  id: string;
  teamId: string;
  displayName: string;
  organizationRole: "lead" | "researcher";
};

export type ProjectSummary = {
  id: string;
  title: string;
  leadName: string;
  states: Array<{ dimension: string; state: string }>;
};

export type ProjectOverview = ProjectSummary & {
  members: Array<{ id: string; displayName: string; role: string }>;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing required environment variable: DATABASE_URL");
  return value;
}

type WebDbClient = ReturnType<typeof createDbClient>;

const globalWebDb = globalThis as typeof globalThis & {
  __researchWorkbenchDb?: WebDbClient;
};

function webDb(): WebDbClient {
  globalWebDb.__researchWorkbenchDb ??= createDbClient(databaseUrl());
  return globalWebDb.__researchWorkbenchDb;
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const session = await getWorkbenchAuth().api.getSession({
    headers: await headers(),
  });
  if (!session?.user?.id) return null;

  const db = webDb();
  const rows = await db.sql.unsafe(
      `select id, team_id, display_name, organization_role
       from members
       where auth_user_id = $1 and active = true and actor_type = 'human'
       limit 1`,
      [session.user.id],
    );
    const row = rows[0];
    if (!row) return null;

  return {
    id: String(row.id),
    teamId: String(row.team_id),
    displayName: String(row.display_name),
    organizationRole: row.organization_role as "lead" | "researcher",
  };
}

export async function requireCurrentMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return member;
}

async function loadStates(
  sql: ReturnType<typeof createDbClient>["sql"],
  projectId: string,
): Promise<Array<{ dimension: string; state: string }>> {
  const rows = await sql.unsafe(
    `select dimension, state
     from research_dimension_states
     where project_id = $1
     order by updated_at desc, dimension asc`,
    [projectId],
  );
  return rows.map((row) => ({
    dimension: String(row.dimension),
    state: String(row.state),
  }));
}

export async function listVisibleProjects(
  member: CurrentMember,
): Promise<ProjectSummary[]> {
  const db = webDb();
  const rows = await db.sql.unsafe(
      `select distinct p.id, p.title, lead.display_name as lead_name, p.created_at
       from research_projects p
       join research_portfolios rp on rp.id = p.portfolio_id
       join members lead on lead.id = p.lead_member_id
       left join project_memberships pm
         on pm.project_id = p.id and pm.member_id = $1
       where rp.team_id = $2
         and ($3 = 'lead' or pm.id is not null)
       order by p.created_at asc, p.id asc`,
      [member.id, member.teamId, member.organizationRole],
    );

  return Promise.all(
    rows.map(async (row) => ({
      id: String(row.id),
      title: String(row.title),
      leadName: String(row.lead_name),
      states: await loadStates(db.sql, String(row.id)),
    })),
  );
}

export async function getProjectOverview(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectOverview | null> {
  const db = webDb();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const projects = await db.sql.unsafe(
      `select p.id, p.title, lead.display_name as lead_name
       from research_projects p
       join members lead on lead.id = p.lead_member_id
       where p.id = $1
       limit 1`,
      [projectId],
    );
    const project = projects[0];
    if (!project) return null;

    const members = await db.sql.unsafe(
      `select m.id, m.display_name, pm.role
       from project_memberships pm
       join members m on m.id = pm.member_id
       where pm.project_id = $1
       order by case when pm.role = 'lead' then 0 else 1 end, m.display_name asc`,
      [projectId],
    );

  return {
    id: String(project.id),
    title: String(project.title),
    leadName: String(project.lead_name),
    states: await loadStates(db.sql, projectId),
    members: members.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      role: String(row.role),
    })),
  };
}

export async function listTeamMembers(member: CurrentMember) {
  const db = webDb();
  const rows = await db.sql.unsafe(
      `select id, display_name, email, organization_role
       from members
       where team_id = $1 and active = true and actor_type = 'human'
       order by case when organization_role = 'lead' then 0 else 1 end, display_name asc`,
      [member.teamId],
    );
  return rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    email: String(row.email),
    organizationRole: String(row.organization_role),
  }));
}
