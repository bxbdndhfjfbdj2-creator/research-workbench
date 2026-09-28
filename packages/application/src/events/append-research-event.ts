import {
  assertSecretSafe,
  type ResearchEventInput,
  type ResearchEventRecord,
} from "@research-workbench/domain/src/events";
import type { TransactionSql } from "../transactions";

type InsertedResearchEvent = {
  created_at: Date;
};

export async function appendResearchEvent(
  tx: TransactionSql,
  event: ResearchEventInput,
): Promise<ResearchEventRecord> {
  assertSecretSafe(event.payload);

  const rows = (await tx.unsafe(
    `insert into research_events
      (id, project_id, event_type, actor_type, actor_id, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning created_at`,
    [
      event.id,
      event.projectId,
      event.eventType,
      event.actor.type,
      event.actor.id,
      JSON.stringify(event.payload),
    ],
  )) as readonly InsertedResearchEvent[];

  const inserted = rows[0];
  if (!inserted) throw new Error("Research event insert returned no row");

  return {
    ...event,
    createdAt: inserted.created_at,
  };
}
