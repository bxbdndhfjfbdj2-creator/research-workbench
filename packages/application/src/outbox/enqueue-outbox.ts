import {
  assertSecretSafe,
  type OutboxInput,
  type OutboxRecord,
} from "@research-workbench/domain/src/events";
import type { TransactionSql } from "../transactions";

type InsertedOutbox = {
  status: "pending";
  attempts: number;
  created_at: Date;
};

export async function enqueueOutbox(
  tx: TransactionSql,
  event: OutboxInput,
): Promise<OutboxRecord> {
  assertSecretSafe(event.payload);

  const rows = (await tx.unsafe(
    `insert into outbox_events (id, event_type, payload)
     values ($1, $2, $3::jsonb)
     returning status, attempts, created_at`,
    [event.id, event.eventType, JSON.stringify(event.payload)],
  )) as readonly InsertedOutbox[];

  const inserted = rows[0];
  if (!inserted) throw new Error("Outbox insert returned no row");

  return {
    ...event,
    status: inserted.status,
    attempts: inserted.attempts,
    createdAt: inserted.created_at,
  };
}
