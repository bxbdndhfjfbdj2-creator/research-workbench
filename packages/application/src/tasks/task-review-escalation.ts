import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import { assertSecretSafe } from "@research-workbench/domain/src/events";
import type {
  DecisionProposal,
  DecisionStatus,
  ScientificDecision,
} from "@research-workbench/domain/src/scientific-decision";
import type {
  ReviewRequest,
  ReviewRequestStatus,
} from "@research-workbench/domain/src/task-review";
import {
  createScientificDecisionInTransaction,
} from "../decisions/create-decision";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import { assertEligibleReviewer } from "./task-permissions";

type ReviewRow = {
  id: string;
  project_id: string;
  task_submission_id: string;
  reviewer_member_id: string;
  status: ReviewRequestStatus;
  created_by_member_id: string;
  created_at: Date;
  updated_at: Date;
};

type LinkedDecisionRow = {
  review_request_id: string;
  project_id: string;
  task_submission_id: string;
  decision_status: DecisionStatus;
};

function toReviewRequest(row: ReviewRow): ReviewRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    taskSubmissionId: row.task_submission_id,
    reviewerMemberId: row.reviewer_member_id,
    status: row.status,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function lockReviewRequest(
  tx: TransactionSql,
  reviewRequestId: string,
): Promise<ReviewRow> {
  const rows = (await tx.unsafe(
    `select id, project_id, task_submission_id, reviewer_member_id, status,
            created_by_member_id, created_at, updated_at
     from review_requests
     where id = $1
     for update`,
    [reviewRequestId],
  )) as readonly ReviewRow[];
  const row = rows[0];
  if (!row) throw new Error("Review request not found");
  return row;
}

async function loadResearchTaskId(
  tx: TransactionSql,
  submissionId: string,
): Promise<string> {
  const rows = (await tx.unsafe(
    "select research_task_id from task_submissions where id = $1 limit 1",
    [submissionId],
  )) as readonly { research_task_id: string }[];
  const row = rows[0];
  if (!row) throw new Error("Task submission not found");
  return row.research_task_id;
}

function validateEscalationProposal(
  proposal: Omit<DecisionProposal, "projectId">,
): void {
  if (!proposal.title.trim()) throw new Error("Scientific decision title is required");
  if (!proposal.reason.trim()) throw new Error("Scientific decision reason is required");
  assertSecretSafe({
    evidence: proposal.evidence,
    impact: proposal.impact,
    change: proposal.change,
  });
}

export async function escalateReviewToScientificDecision(
  sql: DatabaseSql,
  reviewRequestId: string,
  proposal: Omit<DecisionProposal, "projectId">,
  actor: ActorRef,
): Promise<{ review: ReviewRequest; decision: ScientificDecision }> {
  assertHumanActor(actor);
  validateEscalationProposal(proposal);

  return runInTransaction(sql, async (tx) => {
    const review = await lockReviewRequest(tx, reviewRequestId);
    if (review.status !== "pending") {
      throw new Error("Only a pending review can be escalated");
    }
    if (review.reviewer_member_id !== actor.id) {
      throw new Error("Forbidden: only the current assigned reviewer may escalate");
    }
    await assertEligibleReviewer(
      tx,
      review.project_id,
      review.task_submission_id,
      actor.id,
    );

    const unresolved = await tx.unsafe(
      `select 1
       from review_decision_links l
       join scientific_decisions d on d.id = l.scientific_decision_id
       where l.review_request_id = $1
         and d.status not in ('approved', 'rejected')
       limit 1`,
      [review.id],
    );
    if (unresolved.length > 0) {
      throw new Error("Review already has an unresolved scientific decision");
    }

    const decision = await createScientificDecisionInTransaction(
      tx,
      {
        ...proposal,
        projectId: review.project_id,
      },
      actor,
    );

    await tx.unsafe(
      `insert into review_decision_links
        (id, review_request_id, scientific_decision_id, created_by_member_id)
       values ($1, $2, $3, $4)`,
      [randomUUID(), review.id, decision.id, actor.id],
    );

    const updatedRows = (await tx.unsafe(
      `update review_requests
       set status = 'awaiting_scientific_decision', updated_at = now()
       where id = $1
       returning id, project_id, task_submission_id, reviewer_member_id, status,
                 created_by_member_id, created_at, updated_at`,
      [review.id],
    )) as readonly ReviewRow[];
    const updatedReview = updatedRows[0];
    if (!updatedReview) throw new Error("Review escalation returned no row");

    await tx.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id, resulting_status)
       values ($1, $2, 'escalate_to_scientific_decision', 'human', $3,
               'awaiting_scientific_decision')`,
      [randomUUID(), review.id, actor.id],
    );

    const researchTaskId = await loadResearchTaskId(tx, review.task_submission_id);
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: review.project_id,
      eventType: "REVIEW_ESCALATED",
      actor,
      payload: {
        reviewRequestId: review.id,
        researchTaskId,
        taskSubmissionId: review.task_submission_id,
        scientificDecisionId: decision.id,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.review.escalated",
      payload: {
        projectId: review.project_id,
        reviewRequestId: review.id,
        researchTaskId,
        taskSubmissionId: review.task_submission_id,
        scientificDecisionId: decision.id,
      },
    });

    return {
      review: toReviewRequest(updatedReview),
      decision,
    };
  });
}

async function loadLinkedDecision(
  sql: Pick<DatabaseSql, "unsafe">,
  decisionId: string,
): Promise<LinkedDecisionRow | null> {
  const rows = (await sql.unsafe(
    `select
       l.review_request_id,
       rr.project_id,
       rr.task_submission_id,
       d.status as decision_status
     from review_decision_links l
     join review_requests rr on rr.id = l.review_request_id
     join scientific_decisions d on d.id = l.scientific_decision_id
     where l.scientific_decision_id = $1
     limit 1`,
    [decisionId],
  )) as readonly LinkedDecisionRow[];
  return rows[0] ?? null;
}

export async function resumeReviewAfterScientificDecision(
  sql: DatabaseSql,
  decisionId: string,
): Promise<"resumed" | "not_linked" | "not_terminal" | "already_resolved"> {
  const initial = await loadLinkedDecision(sql, decisionId);
  if (!initial) return "not_linked";
  if (!["approved", "rejected"].includes(initial.decision_status)) {
    return "not_terminal";
  }

  return runInTransaction(sql, async (tx) => {
    const linked = await loadLinkedDecision(tx, decisionId);
    if (!linked) return "not_linked" as const;
    if (!["approved", "rejected"].includes(linked.decision_status)) {
      return "not_terminal" as const;
    }

    const review = await lockReviewRequest(tx, linked.review_request_id);

    const latestLinks = (await tx.unsafe(
      `select scientific_decision_id
       from review_decision_links
       where review_request_id = $1
       order by created_at desc, id desc
       limit 1`,
      [review.id],
    )) as readonly { scientific_decision_id: string }[];
    if (latestLinks[0]?.scientific_decision_id !== decisionId) {
      return "already_resolved" as const;
    }

    const resolutionEvents = await tx.unsafe(
      `select 1
       from research_events
       where project_id = $1
         and event_type = 'REVIEW_SCIENTIFIC_DECISION_RESOLVED'
         and payload->>'reviewRequestId' = $2
         and payload->>'decisionId' = $3
       limit 1`,
      [review.project_id, review.id, decisionId],
    );
    if (resolutionEvents.length > 0) {
      return "already_resolved" as const;
    }
    if (review.status !== "awaiting_scientific_decision") {
      throw new Error("Review is not awaiting this scientific decision");
    }

    await tx.unsafe(
      `update review_requests
       set status = 'pending', updated_at = now()
       where id = $1`,
      [review.id],
    );
    await tx.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id, resulting_status)
       values ($1, $2, 'scientific_decision_resolved', 'system', $3, 'pending')`,
      [randomUUID(), review.id, `scientific-decision:${decisionId}`],
    );

    const actor: ActorRef = {
      type: "system",
      id: "review-resolution-worker",
    };
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: review.project_id,
      eventType: "REVIEW_SCIENTIFIC_DECISION_RESOLVED",
      actor,
      payload: {
        reviewRequestId: review.id,
        decisionId,
        decisionStatus: linked.decision_status,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.review.scientific_decision_resolved",
      payload: {
        projectId: review.project_id,
        reviewRequestId: review.id,
        decisionId,
        decisionStatus: linked.decision_status,
      },
    });

    return "resumed" as const;
  });
}
