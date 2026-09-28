import type { DatabaseSql } from "@research-workbench/db/src/client";

export type ProjectAction = "read" | "write";

export async function authorizeProjectAccess(
  _sql: DatabaseSql,
  _actorId: string,
  _projectId: string,
  _action: ProjectAction,
): Promise<void> {
  throw new Error("authorizeProjectAccess not implemented");
}
