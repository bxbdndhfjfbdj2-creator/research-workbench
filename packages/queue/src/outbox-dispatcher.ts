import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";

export type ClaimedOutboxRecord = {
  id: string;
  eventType: string;
  payload: JsonValue;
  attempts: number;
};

export async function claimOutboxBatch(
  _sql: DatabaseSql,
  _limit: number,
): Promise<ClaimedOutboxRecord[]> {
  throw new Error("claimOutboxBatch not implemented");
}

export async function markOutboxDelivered(
  _sql: DatabaseSql,
  _id: string,
): Promise<void> {
  throw new Error("markOutboxDelivered not implemented");
}

export async function markOutboxFailed(
  _sql: DatabaseSql,
  _id: string,
  _error: unknown,
): Promise<void> {
  throw new Error("markOutboxFailed not implemented");
}
