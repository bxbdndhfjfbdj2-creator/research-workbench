import type { OutboxInput, OutboxRecord } from "@research-workbench/domain/src/events";
import type { TransactionSql } from "../transactions";

export async function enqueueOutbox(
  _tx: TransactionSql,
  _event: OutboxInput,
): Promise<OutboxRecord> {
  throw new Error("enqueueOutbox not implemented");
}
