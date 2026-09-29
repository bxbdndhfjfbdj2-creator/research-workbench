import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type {
  ResearchDimension,
  ResearchDimensionState,
  ResearchDimensionStateValue,
} from "@research-workbench/domain/src/research-dimensions";

export async function setDimensionState(
  _sql: DatabaseSql,
  _projectId: string,
  _dimension: ResearchDimension,
  _state: ResearchDimensionStateValue,
  _actor: ActorRef,
): Promise<ResearchDimensionState> {
  throw new Error("setDimensionState not implemented");
}
