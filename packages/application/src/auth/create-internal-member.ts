import type { DatabaseSql } from "@research-workbench/db/src/client";

export type OrganizationRole = "lead" | "researcher";

export type CreateInternalMemberInput = {
  id: string;
  teamId: string;
  email: string;
  displayName: string;
  organizationRole: OrganizationRole;
  authUserId?: string | null;
};

export type InternalMember = CreateInternalMemberInput & {
  actorType: "human";
  active: true;
};

type CountRow = { count: number };
type InsertedMember = {
  id: string;
  team_id: string;
  email: string;
  display_name: string;
  organization_role: OrganizationRole;
  auth_user_id: string | null;
};

export async function createInternalMember(
  sql: DatabaseSql,
  input: CreateInternalMemberInput,
): Promise<InternalMember> {
  const result = await sql.begin("isolation level serializable", async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))", [input.teamId]);

    const countRows = (await tx.unsafe(
      "select count(*)::int as count from members where team_id = $1 and actor_type = 'human' and active = true",
      [input.teamId],
    )) as readonly CountRow[];

    if ((countRows[0]?.count ?? 0) >= 6) {
      throw new Error("Team capacity is limited to six active human members");
    }

    const rows = (await tx.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active, auth_user_id)
       values ($1, $2, $3, $4, $5, 'human', true, $6)
       returning id, team_id, email, display_name, organization_role, auth_user_id`,
      [
        input.id,
        input.teamId,
        input.email.trim().toLowerCase(),
        input.displayName.trim(),
        input.organizationRole,
        input.authUserId ?? null,
      ],
    )) as readonly InsertedMember[];

    const inserted = rows[0];
    if (!inserted) throw new Error("Member insert returned no row");
    return inserted;
  });

  const inserted = result as InsertedMember;
  return {
    id: inserted.id,
    teamId: inserted.team_id,
    email: inserted.email,
    displayName: inserted.display_name,
    organizationRole: inserted.organization_role,
    authUserId: inserted.auth_user_id,
    actorType: "human",
    active: true,
  };
}
