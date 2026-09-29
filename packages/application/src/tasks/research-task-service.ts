import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type {
  ResearchTask,
  ResearchTaskStatus,
} from "@research-workbench/domain/src/research-task";

export async function createResearchTask(
  _sql: DatabaseSql,
  _projectId: string,
  _input: { title: string; description?: string | null; assigneeMemberId?: string | null },
  _actor: ActorRef,
): Promise<ResearchTask> {
  throw new Error("createResearchTask not implemented");
}

export async function assignResearchTask(
  _sql: DatabaseSql,
  _taskId: string,
  _memberId: string,
  _actor: ActorRef,
): Promise<ResearchTask> {
  throw new Error("assignResearchTask not implemented");
}

export async function setResearchTaskStatus(
  _sql: DatabaseSql,
  _taskId: string,
  _status: ResearchTaskStatus,
  _actor: ActorRef,
): Promise<ResearchTask> {
  throw new Error("setResearchTaskStatus not implemented");
}
