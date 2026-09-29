import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

export type ResultEvidenceRelation = "支持" | "挑战" | "检验";

export async function linkResultEvidence(
  sql: DatabaseSql,
  resultId: string,
  revisionId: string,
  relation: ResultEvidenceRelation,
  actor: ActorRef,
): Promise<void> {
  const rows = await sql.unsafe(
    `select rr.project_id,
            exists (
              select 1 from research_node_revisions r
              join research_nodes n on n.id = r.node_id
              where r.id = $2 and n.project_id = rr.project_id
            ) as revision_matches
     from research_results rr
     where rr.id = $1
     limit 1`,
    [resultId, revisionId],
  );
  const row = rows[0];
  if (!row || row.revision_matches !== true) {
    throw new Error("Result and evidence revision must belong to the same project");
  }
  const projectId = String(row.project_id);
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "write");
  } else {
    throw new Error("Linking formal result evidence requires a human actor");
  }

  await runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    await tx.unsafe(
      `insert into research_result_evidence_links
        (id, project_id, result_id, revision_id, relation, actor_type, actor_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, projectId, resultId, revisionId, relation, actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_RESULT_EVIDENCE_LINKED",
      actor,
      payload: { resultId, revisionId, relation },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.result.evidence-linked",
      payload: { projectId, resultId, revisionId, relation },
    });
  });
}
