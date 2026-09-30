import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import type {
  ReviewRequest,
  ReviewRequestStatus,
} from "@research-workbench/domain/src/task-review";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import {
  assertEligibleReviewer,
  assertProjectOrTeamLead,
} from "./task-permissions";

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

function assertReassignableStatus(status: ReviewRequestStatus): void {
  if (!["pending", "awaiting_scientific_decision"].includes(status)) {
    throw new Error("Finalized review request cannot be reassigned");
  }
}

export async function reassignReviewer(
  sql: DatabaseSql,
  reviewRequestId: string,
  reviewerMemberId: string,
  actor: ActorRef,
): Promise<ReviewRequest> {
  assertHumanActor(actor);
  const targetReviewerMemberId = reviewerMemberId.trim();
  if (!targetReviewerMemberId) throw new Error("Reviewer member id is required");

  return runInTransaction(sql, async (tx) => {
    const review = await lockReviewRequest(tx, reviewRequestId);
    assertReassignableStatus(review.status);
    await assertProjectOrTeamLead(tx, review.project_id, actor.id);
    await assertEligibleReviewer(
      tx,
      review.project_id,
      review.task_submission_id,
      targetReviewerMemberId,
    );

    if (review.reviewer_member_id === targetReviewerMemberId) {
      return toReviewRequest(review);
    }

    const rows = (await tx.unsafe(
      `update review_requests
       set reviewer_member_id = $2, updated_at = now()
       where id = $1
       returning id, project_id, task_submission_id, reviewer_member_id, status,
                 created_by_member_id, created_at, updated_at`,
      [review.id, targetReviewerMemberId],
    )) as readonly ReviewRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Review reassignment returned no row");

    await tx.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id,
         previous_reviewer_member_id, new_reviewer_member_id, resulting_status)
       values ($1, $2, 'reassigned', 'human', $3, $4, $5, $6)`,
      [
        randomUUID(),
        review.id,
        actor.id,
        review.reviewer_member_id,
        targetReviewerMemberId,
        review.status,
      ],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: review.project_id,
      eventType: "REVIEW_REASSIGNED",
      actor,
      payload: {
        reviewRequestId: review.id,
        taskSubmissionId: review.task_submission_id,
        previousReviewerMemberId: review.reviewer_member_id,
        reviewerMemberId: targetReviewerMemberId,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.review.reassigned",
      payload: {
        projectId: review.project_id,
        reviewRequestId: review.id,
        taskSubmissionId: review.task_submission_id,
        reviewerMemberId: targetReviewerMemberId,
      },
    });

    return toReviewRequest(updated);
  });
}
