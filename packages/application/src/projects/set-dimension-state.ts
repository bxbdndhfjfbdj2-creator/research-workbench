import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import type {
  ResearchDimension,
  ResearchDimensionState,
  ResearchDimensionStateValue,
} from "@research-workbench/domain/src/research-dimensions";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

type DimensionRow = {
  id: string;
  project_id: string;
  dimension: ResearchDimension;
  state: ResearchDimensionStateValue;
  updated_by: string;
  updated_at: Date;
};

export async function setDimensionState(
  sql: DatabaseSql,
  projectId: string,
  dimension: ResearchDimension,
  state: ResearchDimensionStateValue,
  actor: ActorRef,
): Promise<ResearchDimensionState> {
  assertHumanActor(actor);
  await authorizeProjectAccess(sql, actor.id, projectId, "write");

  return runInTransaction(sql, async (tx) => {
    const rows = (await tx.unsafe(
      `insert into research_dimension_states
        (id, project_id, dimension, state, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (project_id, dimension)
       do update set state = excluded.state, updated_by = excluded.updated_by, updated_at = now()
       returning id, project_id, dimension, state, updated_by, updated_at`,
      [randomUUID(), projectId, dimension, state, actor.id],
    )) as readonly DimensionRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_STATE_CHANGED",
      actor,
      payload: { dimension, state },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.state.changed",
      payload: { projectId, dimension, state },
    });

    const row = rows[0];
    if (!row) throw new Error("Research dimension state upsert returned no row");

    return {
      id: row.id,
      projectId: row.project_id,
      dimension: row.dimension,
      state: row.state,
      updatedBy: actor,
      updatedAt: row.updated_at,
    };
  });
}
