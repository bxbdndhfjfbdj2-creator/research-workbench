import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";

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

export async function setProjectMembership(
  _sql: DatabaseSql,
  _projectId: string,
  _memberId: string,
  _role: ProjectMembershipRole,
  _actor: ActorRef,
): Promise<ProjectMembership> {
  throw new Error("setProjectMembership not implemented");
}
