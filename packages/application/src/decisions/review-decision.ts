import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import {
  DECISION_REVIEW_ACTIONS,
  type DecisionReviewAction,
  type ScientificDecision,
} from "@research-workbench/domain/src/scientific-decision";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";
import { applyApprovedDecision } from "./apply-decision";
import { mapDecisionRow } from "./create-decision";

export async function reviewScientificDecision(
  sql: DatabaseSql,
  decisionId: string,
  action: DecisionReviewAction,
  actor: ActorRef,
): Promise<ScientificDecision> {
  if (actor.type !== "human") {
    throw new Error("Scientific decision reviews require a human actor; AI cannot approve decisions");
  }
  if (!(DECISION_REVIEW_ACTIONS as readonly string[]).includes(action)) {
    throw new Error("Invalid scientific decision review action");
  }

  return runInTransaction(sql, async (tx) => {
    const rows = await tx.unsafe(
      `select d.*, p.lead_member_id,
              reviewer.organization_role as reviewer_organization_role,
              reviewer.team_id as reviewer_team_id,
              rp.team_id as project_team_id
       from scientific_decisions d
       join research_projects p on p.id = d.project_id
       join research_portfolios rp on rp.id = p.portfolio_id
       left join members reviewer on reviewer.id = $2 and reviewer.active = true and reviewer.actor_type = 'human'
       where d.id = $1
       for update of d`,
      [decisionId, actor.id],
    );
    const current = rows[0];
    if (!current) throw new Error("Scientific decision not found");
    if (!current.reviewer_organization_role || current.reviewer_team_id !== current.project_team_id) {
      throw new Error("Forbidden: reviewer is not an active member of the project team");
    }

    const status = String(current.status);
    if (status === "approved" || status === "rejected") {
      throw new Error("Scientific decision is already finalized");
    }

    const projectId = String(current.project_id);
    let nextStatus: ScientificDecision["status"];
    let stage: "project_lead" | "team_lead";
    let eventType: string;

    if (status === "proposed" || status === "needs_evidence") {
      if (String(current.lead_member_id) !== actor.id) {
        throw new Error("Project lead review is required before team lead review");
      }
      stage = "project_lead";
      if (action === "request_evidence") {
        nextStatus = "needs_evidence";
        eventType = "SCIENTIFIC_DECISION_EVIDENCE_REQUESTED";
      } else if (action === "reject") {
        nextStatus = "rejected";
        eventType = "SCIENTIFIC_DECISION_REJECTED";
      } else if (current.level === "major") {
        nextStatus = "awaiting_lead";
        eventType = "SCIENTIFIC_DECISION_PROJECT_LEAD_APPROVED";
      } else {
        nextStatus = "approved";
        eventType = "SCIENTIFIC_DECISION_APPROVED";
      }
    } else if (status === "awaiting_lead") {
      if (current.reviewer_organization_role !== "lead") {
        throw new Error("Organization lead approval is required for a major scientific decision");
      }
      stage = "team_lead";
      if (action === "request_evidence") {
        nextStatus = "needs_evidence";
        eventType = "SCIENTIFIC_DECISION_EVIDENCE_REQUESTED";
      } else if (action === "reject") {
        nextStatus = "rejected";
        eventType = "SCIENTIFIC_DECISION_REJECTED";
      } else {
        nextStatus = "approved";
        eventType = "SCIENTIFIC_DECISION_APPROVED";
      }
    } else {
      throw new Error(`Unsupported scientific decision state: ${status}`);
    }

    await tx.unsafe(
      `insert into decision_reviews
        (id, decision_id, stage, action, reviewer_member_id)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), decisionId, stage, action, actor.id],
    );

    const updatedRows = await tx.unsafe(
      `update scientific_decisions
       set status = $2,
           updated_at = now(),
           decided_at = case when $2 in ('approved', 'rejected') then now() else null end
       where id = $1
       returning *`,
      [decisionId, nextStatus],
    );

    if (nextStatus === "approved") {
      await applyApprovedDecision(tx, decisionId, actor);
    }

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType,
      actor,
      payload: { decisionId, action, stage, status: nextStatus },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "scientific.decision.reviewed",
      payload: { projectId, decisionId, status: nextStatus },
    });

    const updated = updatedRows[0];
    if (!updated) throw new Error("Scientific decision update returned no row");
    return mapDecisionRow(updated as Record<string, unknown>);
  });
}
