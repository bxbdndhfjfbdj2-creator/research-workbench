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
