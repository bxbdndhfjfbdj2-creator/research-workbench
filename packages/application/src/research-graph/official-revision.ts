import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type { JsonValue } from "@research-workbench/domain/src/events";
import type { ResearchNodeRevision } from "@research-workbench/domain/src/research-graph";
import {
  OFFICIAL_REVISION_SLOTS,
  type DecisionEvidence,
  type OfficialRevisionSlot,
  type ScientificDecision,
} from "@research-workbench/domain/src/scientific-decision";
import { createScientificDecision } from "../decisions/create-decision";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import type { TransactionSql } from "../transactions";

export async function getOfficialRevision(
  sql: DatabaseSql,
  projectId: string,
  slot: OfficialRevisionSlot,
): Promise<ResearchNodeRevision | null> {
  if (!(OFFICIAL_REVISION_SLOTS as readonly string[]).includes(slot)) {
    throw new Error("Invalid official revision slot");
  }
  const rows = await sql.unsafe(
    `select r.id, r.node_id, r.revision_number, r.content, r.status,
            r.created_by_type, r.created_by_id, r.created_at
     from official_revisions o
     join research_node_revisions r on r.id = o.revision_id
     where o.project_id = $1 and o.slot = $2
     limit 1`,
    [projectId, slot],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    nodeId: String(row.node_id),
    revisionNumber: Number(row.revision_number),
    content: row.content as JsonValue,
    status: row.status as ResearchNodeRevision["status"],
    createdByType: row.created_by_type as ResearchNodeRevision["createdByType"],
    createdById: String(row.created_by_id),
    createdAt: row.created_at as Date,
  };
}

export async function proposeOfficialRevisionChange(
  sql: DatabaseSql,
  input: {
    projectId: string;
    slot: OfficialRevisionSlot;
    revisionId: string;
    reason: string;
    evidence: DecisionEvidence[];
  },
  actor: ActorRef,
): Promise<ScientificDecision> {
  if (!(OFFICIAL_REVISION_SLOTS as readonly string[]).includes(input.slot)) {
    throw new Error("Invalid official revision slot");
  }
  return createScientificDecision(
    sql,
    {
      projectId: input.projectId,
      level: "major",
      title: `变更${input.slot}`,
      reason: input.reason,
      evidence: input.evidence,
      impact: [input.slot],
      change: { kind: "official_revision", slot: input.slot, revisionId: input.revisionId },
    },
    actor,
  );
}

// Internal application boundary: only the decision state machine should call this.
export async function applyApprovedOfficialRevisionChange(
  tx: TransactionSql,
  decisionId: string,
  actor: ActorRef,
): Promise<void> {
  const rows = await tx.unsafe(
    `select id, project_id, target_slot, target_revision_id, status, change_kind
     from scientific_decisions
     where id = $1
     limit 1`,
    [decisionId],
  );
  const decision = rows[0];
  if (
    !decision ||
    decision.status !== "approved" ||
    decision.change_kind !== "official_revision" ||
    !decision.target_slot ||
    !decision.target_revision_id
  ) {
    throw new Error("Only an approved official revision decision can change the official pointer");
  }

  const projectId = String(decision.project_id);
  const slot = String(decision.target_slot);
  const revisionId = String(decision.target_revision_id);
  const pointerId = randomUUID();

  await tx.unsafe(
    `insert into official_revisions (id, project_id, slot, revision_id, decision_id, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (project_id, slot)
     do update set revision_id = excluded.revision_id,
                   decision_id = excluded.decision_id,
                   updated_at = now()`,
    [pointerId, projectId, slot, revisionId, decisionId],
  );
  await tx.unsafe(
    `insert into official_revision_history
      (id, project_id, slot, revision_id, decision_id)
     values ($1, $2, $3, $4, $5)`,
    [randomUUID(), projectId, slot, revisionId, decisionId],
  );
  await appendResearchEvent(tx, {
    id: randomUUID(),
    projectId,
    eventType: "OFFICIAL_REVISION_CHANGED",
    actor,
    payload: { decisionId, slot, revisionId },
  });
  await enqueueOutbox(tx, {
    id: randomUUID(),
    eventType: "research.official-revision.changed",
    payload: { projectId, decisionId, slot, revisionId },
  });
}
