import { randomUUID } from "node:crypto";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import type { TransactionSql } from "../transactions";

async function applyApprovedOfficialRevisionChange(
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

  await tx.unsafe(
    `insert into official_revisions (id, project_id, slot, revision_id, decision_id, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (project_id, slot)
     do update set revision_id = excluded.revision_id,
                   decision_id = excluded.decision_id,
                   updated_at = now()`,
    [randomUUID(), projectId, slot, revisionId, decisionId],
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

export async function applyApprovedDecision(
  tx: TransactionSql,
  decisionId: string,
  actor: ActorRef,
): Promise<void> {
  const rows = await tx.unsafe(
    "select change_kind from scientific_decisions where id = $1 limit 1",
    [decisionId],
  );
  const kind = rows[0]?.change_kind;
  if (!kind) throw new Error("Scientific decision not found");
  if (kind === "record_only") return;
  if (kind === "official_revision") {
    await applyApprovedOfficialRevisionChange(tx, decisionId, actor);
    return;
  }
  throw new Error(`Unsupported scientific decision change kind: ${String(kind)}`);
}
