import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import {
  DECISION_LEVELS,
  type DecisionProposal,
  type ScientificDecision,
} from "@research-workbench/domain/src/scientific-decision";
import type { JsonValue } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

export function mapDecisionRow(row: Record<string, unknown>): ScientificDecision {
  const change =
    row.change_kind === "official_revision"
      ? {
          kind: "official_revision" as const,
          slot: String(row.target_slot) as ScientificDecision["change"] extends infer _ ? any : never,
          revisionId: String(row.target_revision_id),
        }
      : { kind: "record_only" as const };

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    level: row.level as ScientificDecision["level"],
    title: String(row.title),
    reason: String(row.reason),
    evidence: row.evidence as JsonValue,
    impact: row.impact as JsonValue,
    change,
    status: row.status as ScientificDecision["status"],
    proposedBy: {
      type: row.proposed_by_type as ActorRef["type"],
      id: String(row.proposed_by_id),
    },
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    decidedAt: (row.decided_at as Date | null) ?? null,
  };
}

async function authorizeProposal(sql: DatabaseSql, projectId: string, actor: ActorRef) {
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "read");
    return;
  }
  const rows = await sql.unsafe("select 1 from research_projects where id = $1 limit 1", [projectId]);
  if (rows.length === 0) throw new Error("Research project not found");
}

export async function createScientificDecision(
  sql: DatabaseSql,
  input: DecisionProposal,
  actor: ActorRef,
): Promise<ScientificDecision> {
  if (!(DECISION_LEVELS as readonly string[]).includes(input.level)) {
    throw new Error("Invalid scientific decision level");
  }
  if (input.change.kind === "official_revision" && input.level !== "major") {
    throw new Error("Official revision changes must be major scientific decisions");
  }
  await authorizeProposal(sql, input.projectId, actor);

  if (input.change.kind === "official_revision") {
    const rows = await sql.unsafe(
      `select 1
       from research_node_revisions r
       join research_nodes n on n.id = r.node_id
       where r.id = $1 and n.project_id = $2
       limit 1`,
      [input.change.revisionId, input.projectId],
    );
    if (rows.length === 0) throw new Error("Target revision does not belong to the project");
  }

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into scientific_decisions
        (id, project_id, level, title, reason, evidence, impact, change_kind,
         target_slot, target_revision_id, status, proposed_by_type, proposed_by_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, 'proposed', $11, $12)
       returning *`,
      [
        id,
        input.projectId,
        input.level,
        input.title.trim(),
        input.reason.trim(),
        JSON.stringify(input.evidence),
        JSON.stringify(input.impact),
        input.change.kind,
        input.change.kind === "official_revision" ? input.change.slot : null,
        input.change.kind === "official_revision" ? input.change.revisionId : null,
        actor.type,
        actor.id,
      ],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: input.projectId,
      eventType: "SCIENTIFIC_DECISION_CREATED",
      actor,
      payload: {
        decisionId: id,
        level: input.level,
        changeKind: input.change.kind,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "scientific.decision.created",
      payload: { projectId: input.projectId, decisionId: id },
    });
    const row = rows[0];
    if (!row) throw new Error("Scientific decision insert returned no row");
    return mapDecisionRow(row as Record<string, unknown>);
  });
}
