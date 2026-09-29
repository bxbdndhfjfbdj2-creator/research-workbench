import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";

export type ResearchProject = {
  id: string;
  portfolioId: string;
  title: string;
  leadMemberId: string;
  createdAt: Date;
};

export async function createProject(
  _sql: DatabaseSql,
  _input: { portfolioId: string; title: string; leadMemberId: string },
  _actor: ActorRef,
): Promise<ResearchProject> {
  throw new Error("createProject not implemented");
}
