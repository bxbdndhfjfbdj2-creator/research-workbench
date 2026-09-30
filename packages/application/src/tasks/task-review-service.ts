import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import type {
  ReviewRequest,
  ReviewRequestStatus,
} from "@research-workbench/domain/src/task-review";
import type { ResearchTaskStatus } from "@research-workbench/domain/src/research-task";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import {
  assertEligibleReviewer,
  assertProjectOrTeamLead,
} from "./task-permissions";

const REVIEW_COMMENT_MAX = 4_000;

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

type ReviewContextRow = {
  project_id: string;
  task_submission_id: string;
  research_task_id: string;
};

type TaskStateRow = {
  id: string;
  status: ResearchTaskStatus;
};

type OrdinaryReviewOutcome = "approved" | "changes_requested" | "rejected";
type OrdinaryReviewAction = "approve" | "request_changes" | "reject";

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

function normalizeReviewComment(
  value: string | null | undefined,
  required: boolean,
): string | null {
  const comment = value?.trim() || null;
  if (required && !comment) throw new Error("Review comment is required");
  if (comment && comment.length > REVIEW_COMMENT_MAX) {
    throw new Error(
      `Review comment must be at most ${REVIEW_COMMENT_MAX} characters`,
    );
  }
  return comment;
}

async function loadReviewContext(
  tx: TransactionSql,
  reviewRequestId: string,
): Promise<ReviewContextRow> {
  const rows = (await tx.unsafe(
    `select rr.project_id, rr.task_submission_id, ts.research_task_id
     from review_requests rr
     join task_submissions ts on ts.id = rr.task_submission_id
     where rr.id = $1
     limit 1`,
    [reviewRequestId],
  )) as readonly ReviewContextRow[];
  const row = rows[0];
  if (!row) throw new Error("Review request not found");
  return row;
}

async function lockTaskState(
  tx: TransactionSql,
  taskId: string,
): Promise<TaskStateRow> {
  const rows = (await tx.unsafe(
    `select id, status
     from research_tasks
     where id = $1
     for update`,
    [taskId],
  )) as readonly TaskStateRow[];
  const row = rows[0];
  if (!row) throw new Error("Research task not found");
  return row;
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

async function executeOrdinaryReviewOutcome(
  sql: DatabaseSql,
  reviewRequestId: string,
  outcome: OrdinaryReviewOutcome,
  action: OrdinaryReviewAction,
  eventType: string,
  comment: string | null,
  actor: ActorRef,
): Promise<ReviewRequest> {
  return runInTransaction(sql, async (tx) => {
    const context = await loadReviewContext(tx, reviewRequestId);

    // All ordinary review decisions lock Task before Review so approve/cancel
    // cannot deadlock by taking the same rows in the opposite order.
    const task = await lockTaskState(tx, context.research_task_id);
    const review = await lockReviewRequest(tx, reviewRequestId);

    if (
      review.project_id !== context.project_id ||
      review.task_submission_id !== context.task_submission_id
    ) {
      throw new Error("Review request provenance changed unexpectedly");
    }
    if (review.status !== "pending") {
      throw new Error("Review request is not pending");
    }
    if (task.status !== "awaiting_review") {
      throw new Error("Research task is not awaiting review");
    }
    if (review.reviewer_member_id !== actor.id) {
      throw new Error("Forbidden: only the current assigned reviewer may act");
    }

    await assertEligibleReviewer(
      tx,
      review.project_id,
      review.task_submission_id,
      actor.id,
    );

    const reviewRows = (await tx.unsafe(
      `update review_requests
       set status = $2, updated_at = now()
       where id = $1
       returning id, project_id, task_submission_id, reviewer_member_id, status,
                 created_by_member_id, created_at, updated_at`,
      [review.id, outcome],
    )) as readonly ReviewRow[];
    const updatedReview = reviewRows[0];
    if (!updatedReview) throw new Error("Review outcome update returned no row");

    await tx.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id, comment, resulting_status)
       values ($1, $2, $3, 'human', $4, $5, $6)`,
      [randomUUID(), review.id, action, actor.id, comment, outcome],
    );

    const nextTaskStatus: ResearchTaskStatus =
      outcome === "approved" ? "completed" : "in_progress";
    await tx.unsafe(
      `update research_tasks
       set status = $2, updated_at = now()
       where id = $1`,
      [task.id, nextTaskStatus],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: review.project_id,
      eventType,
      actor,
      payload: {
        reviewRequestId: review.id,
        researchTaskId: task.id,
        taskSubmissionId: review.task_submission_id,
        reviewerMemberId: actor.id,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType:
        outcome === "approved"
          ? "research.task.review.approved"
          : outcome === "changes_requested"
            ? "research.task.review.changes_requested"
            : "research.task.review.rejected",
      payload: {
        projectId: review.project_id,
        reviewRequestId: review.id,
        researchTaskId: task.id,
        taskSubmissionId: review.task_submission_id,
      },
    });

    if (outcome === "approved") {
      await appendResearchEvent(tx, {
        id: randomUUID(),
        projectId: review.project_id,
        eventType: "RESEARCH_TASK_COMPLETED",
        actor,
        payload: {
          researchTaskId: task.id,
          submissionId: review.task_submission_id,
          completionKind: "review_approved",
        },
      });
      await enqueueOutbox(tx, {
        id: randomUUID(),
        eventType: "research.task.completed",
        payload: {
          projectId: review.project_id,
          researchTaskId: task.id,
          submissionId: review.task_submission_id,
          completionKind: "review_approved",
        },
      });
    }

    return toReviewRequest(updatedReview);
  });
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

export async function approveSubmission(
  sql: DatabaseSql,
  reviewRequestId: string,
  comment: string | null | undefined,
  actor: ActorRef,
): Promise<ReviewRequest> {
  assertHumanActor(actor);
  return executeOrdinaryReviewOutcome(
    sql,
    reviewRequestId,
    "approved",
    "approve",
    "REVIEW_APPROVED",
    normalizeReviewComment(comment, false),
    actor,
  );
}

export async function requestSubmissionChanges(
  sql: DatabaseSql,
  reviewRequestId: string,
  comment: string,
  actor: ActorRef,
): Promise<ReviewRequest> {
  assertHumanActor(actor);
  return executeOrdinaryReviewOutcome(
    sql,
    reviewRequestId,
    "changes_requested",
    "request_changes",
    "REVIEW_CHANGES_REQUESTED",
    normalizeReviewComment(comment, true),
    actor,
  );
}

export async function rejectSubmission(
  sql: DatabaseSql,
  reviewRequestId: string,
  comment: string,
  actor: ActorRef,
): Promise<ReviewRequest> {
  assertHumanActor(actor);
  return executeOrdinaryReviewOutcome(
    sql,
    reviewRequestId,
    "rejected",
    "reject",
    "REVIEW_REJECTED",
    normalizeReviewComment(comment, true),
    actor,
  );
}
