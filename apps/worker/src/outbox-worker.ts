import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  claimOutboxBatch,
  markOutboxDelivered,
  markOutboxFailed,
  type ClaimedOutboxRecord,
} from "@research-workbench/queue/src/outbox-dispatcher";

export type OutboxDispatchHandler = (record: ClaimedOutboxRecord) => Promise<void>;

export async function runOutboxPass(
  sql: DatabaseSql,
  dispatch: OutboxDispatchHandler,
  limit = 25,
): Promise<number> {
  const records = await claimOutboxBatch(sql, limit);

  for (const record of records) {
    try {
      await dispatch(record);
      await markOutboxDelivered(sql, record.id);
    } catch (error) {
      await markOutboxFailed(sql, record.id, error);
    }
  }

  return records.length;
}
