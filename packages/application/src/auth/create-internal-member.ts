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

export async function createInternalMember(
  _sql: DatabaseSql,
  _input: CreateInternalMemberInput,
): Promise<InternalMember> {
  throw new Error("createInternalMember not implemented");
}
