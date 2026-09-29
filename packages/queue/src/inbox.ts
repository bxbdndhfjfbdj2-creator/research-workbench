import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  assertSecretSafe,
  type JsonValue,
} from "@research-workbench/domain/src/events";

type InboxIdRow = { id: string };

export async function acceptExternalEvent(
  sql: DatabaseSql,
  provider: string,
  externalId: string,
  payload: JsonValue,
): Promise<{ accepted: boolean; inboxId: string }> {
  assertSecretSafe(payload);
  const proposedId = randomUUID();

  const inserted = (await sql.unsafe(
    `insert into integration_inbox (id, provider, external_id, payload)
     values ($1, $2, $3, $4::jsonb)
     on conflict (provider, external_id) do nothing
     returning id`,
    [proposedId, provider, externalId, JSON.stringify(payload)],
  )) as readonly InboxIdRow[];

  if (inserted[0]) {
    return { accepted: true, inboxId: inserted[0].id };
  }

  const existing = (await sql.unsafe(
    "select id from integration_inbox where provider = $1 and external_id = $2 limit 1",
    [provider, externalId],
  )) as readonly InboxIdRow[];
  if (!existing[0]) {
    throw new Error("Inbox idempotency lookup failed after conflict");
  }
  return { accepted: false, inboxId: existing[0].id };
}
