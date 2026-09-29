import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";

export type ClaimedOutboxRecord = {
  id: string;
  eventType: string;
  payload: JsonValue;
  attempts: number;
};

type OutboxRow = {
  id: string;
  event_type: string;
  payload: JsonValue;
  attempts: number;
};

export async function claimOutboxBatch(
  sql: DatabaseSql,
  limit: number,
): Promise<ClaimedOutboxRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Outbox claim limit must be an integer between 1 and 100");
  }

  const result = await sql.begin(async (tx) => {
    const rows = (await tx.unsafe(
      `with candidates as (
         select id
         from outbox_events
         where available_at <= now()
           and (
             status = 'pending'
             or (status = 'processing' and claimed_at < now() - interval '60 seconds')
           )
         order by created_at, id
         for update skip locked
         limit $1
       )
       update outbox_events o
       set status = 'processing',
           attempts = o.attempts + 1,
           claimed_at = now(),
           last_error = null
       from candidates c
       where o.id = c.id
       returning o.id, o.event_type, o.payload, o.attempts`,
      [limit],
    )) as readonly OutboxRow[];
    return rows;
  });

  return (result as readonly OutboxRow[]).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function markOutboxDelivered(
  sql: DatabaseSql,
  id: string,
): Promise<void> {
  await sql.unsafe(
    `update outbox_events
     set status = 'delivered', delivered_at = now(), claimed_at = null, last_error = null
     where id = $1`,
    [id],
  );
}

export async function markOutboxFailed(
  sql: DatabaseSql,
  id: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await sql.unsafe(
    `update outbox_events
     set status = 'pending',
         claimed_at = null,
         last_error = $2,
         available_at = now() + interval '5 seconds'
     where id = $1`,
    [id, message.slice(0, 1000)],
  );
}
