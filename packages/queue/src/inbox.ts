import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";

export async function acceptExternalEvent(
  _sql: DatabaseSql,
  _provider: string,
  _externalId: string,
  _payload: JsonValue,
): Promise<{ accepted: boolean; inboxId: string }> {
  throw new Error("acceptExternalEvent not implemented");
}
