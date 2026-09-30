import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  cancelResearchTask,
  createResearchTask,
  reopenResearchTask,
  startResearchTask,
} from "./research-task-service";
import { submitResearchTask } from "./task-submission-service";
import {
  approveSubmission,
  reassignReviewer,
  rejectSubmission,
  requestSubmissionChanges,
} from "./task-review-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("task review reviewer assignment", () => {
  let testDb: TestDatabase;
  const teamId = "review-assignment-team";
  const portfolioId = "review-assignment-portfolio";
  const projectId = "review-assignment-project";
  const projectLeadId = "review-assignment-project-lead";
  const teamLeadId = "review-assignment-team-lead";
  const ownerId = "review-assignment-owner";
  const reviewerAId = "review-assignment-reviewer-a";
  const reviewerBId = "review-assignment-reviewer-b";
  const contributorId = "review-assignment-contributor";
  const inactiveId = "review-assignment-inactive";
  const outsiderId = "review-assignment-outsider";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ($1, 'Review Assignment Team')",
      [teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ($1, $9, 'project-lead@review.test', 'Project Lead', 'researcher', 'human', true),
        ($2, $9, 'team-lead@review.test', 'Team Lead', 'lead', 'human', true),
        ($3, $9, 'owner@review.test', 'Owner', 'researcher', 'human', true),
        ($4, $9, 'reviewer-a@review.test', 'Reviewer A', 'researcher', 'human', true),
        ($5, $9, 'reviewer-b@review.test', 'Reviewer B', 'researcher', 'human', true),
        ($6, $9, 'contributor@review.test', 'Contributor', 'researcher', 'human', true),
        ($7, $9, 'inactive@review.test', 'Inactive', 'researcher', 'human', false),
        ($8, $9, 'outsider@review.test', 'Outsider', 'researcher', 'human', true)`,
      [
        projectLeadId,
        teamLeadId,
        ownerId,
        reviewerAId,
        reviewerBId,
        contributorId,
        inactiveId,
        outsiderId,
        teamId,
      ],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ($1, $2, 'Review Assignment Portfolio')",
      [portfolioId, teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ($1, $2, 'Review Assignment Project', $3)`,
      [projectId, portfolioId, projectLeadId],
    );

    for (const [membershipId, memberId, role] of [
      ["review-assignment-project-lead-membership", projectLeadId, "lead"],
      ["review-assignment-owner-membership", ownerId, "collaborator"],
      ["review-assignment-reviewer-a-membership", reviewerAId, "collaborator"],
      ["review-assignment-reviewer-b-membership", reviewerBId, "collaborator"],
      ["review-assignment-contributor-membership", contributorId, "collaborator"],
      ["review-assignment-inactive-membership", inactiveId, "collaborator"],
    ] as const) {
      await testDb.client.sql.unsafe(
        `insert into project_memberships (id, project_id, member_id, role)
         values ($1, $2, $3, $4)`,
        [membershipId, projectId, memberId, role],
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createPendingReview(
    title: string,
    contributors: { kind: "human_member"; memberId: string }[] = [],
  ) {
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      {
        title,
        reviewPolicy: "required",
      },
      { type: "human", id: ownerId },
    );
    await startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: ownerId },
    );
    const result = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: "Ready for reviewer assignment",
        contributors,
        reviewerMemberId: reviewerAId,
      },
      { type: "human", id: ownerId },
    );
    if (!result.reviewRequestId) throw new Error("Expected required review request");
    return {
      taskId: task.id,
      submissionId: result.submission.id,
      reviewRequestId: result.reviewRequestId,
    };
  }

  it("allows only project/team leads to reassign and preserves assignment history", async () => {
    const review = await createPendingReview("Lead-only reassignment");

    await expect(
      reassignReviewer(
        testDb.client.sql,
        review.reviewRequestId,
        reviewerBId,
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/lead|forbidden/i);

    const reassigned = await reassignReviewer(
      testDb.client.sql,
      review.reviewRequestId,
      reviewerBId,
      { type: "human", id: projectLeadId },
    );
    expect(reassigned).toMatchObject({
      id: review.reviewRequestId,
      reviewerMemberId: reviewerBId,
      status: "pending",
    });

    const actions = await testDb.client.sql.unsafe(
      `select action, actor_id, previous_reviewer_member_id,
              new_reviewer_member_id, resulting_status
       from review_actions
       where review_request_id = $1
       order by created_at, id`,
      [review.reviewRequestId],
    );
    expect(actions).toEqual([
      {
        action: "assigned",
        actor_id: ownerId,
        previous_reviewer_member_id: null,
        new_reviewer_member_id: reviewerAId,
        resulting_status: "pending",
      },
      {
        action: "reassigned",
        actor_id: projectLeadId,
        previous_reviewer_member_id: reviewerAId,
        new_reviewer_member_id: reviewerBId,
        resulting_status: "pending",
      },
    ]);

    const events = await testDb.client.sql.unsafe(
      `select payload
       from research_events
       where project_id = $1
         and event_type = 'REVIEW_REASSIGNED'
         and payload->>'reviewRequestId' = $2`,
      [projectId, review.reviewRequestId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      reviewRequestId: review.reviewRequestId,
      taskSubmissionId: review.submissionId,
      previousReviewerMemberId: reviewerAId,
      reviewerMemberId: reviewerBId,
    });
  });

  it("accepts team-lead reassignment without requiring project membership", async () => {
    const review = await createPendingReview("Team lead reassignment");
    const reassigned = await reassignReviewer(
      testDb.client.sql,
      review.reviewRequestId,
      reviewerBId,
      { type: "human", id: teamLeadId },
    );
    expect(reassigned.reviewerMemberId).toBe(reviewerBId);
  });

  it("recalculates target reviewer eligibility from current membership and activity", async () => {
    const inactiveReview = await createPendingReview("Inactive target");
    await expect(
      reassignReviewer(
        testDb.client.sql,
        inactiveReview.reviewRequestId,
        inactiveId,
        { type: "human", id: projectLeadId },
      ),
    ).rejects.toThrow(/reviewer|active|access|project/i);

    const outsiderReview = await createPendingReview("Outsider target");
    await expect(
      reassignReviewer(
        testDb.client.sql,
        outsiderReview.reviewRequestId,
        outsiderId,
        { type: "human", id: projectLeadId },
      ),
    ).rejects.toThrow(/reviewer|access|project/i);

    const staleReview = await createPendingReview("Stale target");
    await testDb.client.sql.unsafe(
      "update members set active = false where id = $1",
      [reviewerBId],
    );
    try {
      await expect(
        reassignReviewer(
          testDb.client.sql,
          staleReview.reviewRequestId,
          reviewerBId,
          { type: "human", id: projectLeadId },
        ),
      ).rejects.toThrow(/reviewer|active|access|project/i);
    } finally {
      await testDb.client.sql.unsafe(
        "update members set active = true where id = $1",
        [reviewerBId],
      );
    }
  });

  it("rejects contributor self-review even when a lead performs the reassignment", async () => {
    const review = await createPendingReview(
      "Contributor target",
      [{ kind: "human_member", memberId: contributorId }],
    );

    await expect(
      reassignReviewer(
        testDb.client.sql,
        review.reviewRequestId,
        contributorId,
        { type: "human", id: projectLeadId },
      ),
    ).rejects.toThrow(/contribut|self|review/i);
  });

  it("rejects non-human reassignment actors", async () => {
    const review = await createPendingReview("AI cannot reassign");
    await expect(
      reassignReviewer(
        testDb.client.sql,
        review.reviewRequestId,
        reviewerBId,
        { type: "agent", id: "agent-reviewer" },
      ),
    ).rejects.toThrow(/human/i);
  });

  it("lets only the current eligible reviewer approve and records accepted-submission provenance", async () => {
    const review = await createPendingReview("Approve delivery");

    await expect(
      approveSubmission(
        testDb.client.sql,
        review.reviewRequestId,
        "Wrong reviewer",
        { type: "human", id: reviewerBId },
      ),
    ).rejects.toThrow(/reviewer|assigned|forbidden/i);

    await expect(
      approveSubmission(
        testDb.client.sql,
        review.reviewRequestId,
        "Agent cannot approve",
        { type: "agent", id: "agent-reviewer" },
      ),
    ).rejects.toThrow(/human/i);

    const beforeOfficial = await testDb.client.sql.unsafe(
      "select count(*)::int as count from official_revisions where project_id = $1",
      [projectId],
    );

    const approved = await approveSubmission(
      testDb.client.sql,
      review.reviewRequestId,
      "Looks good",
      { type: "human", id: reviewerAId },
    );
    expect(approved.status).toBe("approved");

    const taskRows = await testDb.client.sql.unsafe(
      "select status from research_tasks where id = $1",
      [review.taskId],
    );
    expect(taskRows[0]?.status).toBe("completed");

    const actions = await testDb.client.sql.unsafe(
      `select action, actor_id, comment, resulting_status
       from review_actions
       where review_request_id = $1 and action = 'approve'`,
      [review.reviewRequestId],
    );
    expect(actions).toEqual([
      {
        action: "approve",
        actor_id: reviewerAId,
        comment: "Looks good",
        resulting_status: "approved",
      },
    ]);

    const completionEvents = await testDb.client.sql.unsafe(
      `select payload from research_events
       where project_id = $1
         and event_type = 'RESEARCH_TASK_COMPLETED'
         and payload->>'researchTaskId' = $2`,
      [projectId, review.taskId],
    );
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0]?.payload).toEqual({
      researchTaskId: review.taskId,
      submissionId: review.submissionId,
      completionKind: "review_approved",
    });

    const afterOfficial = await testDb.client.sql.unsafe(
      "select count(*)::int as count from official_revisions where project_id = $1",
      [projectId],
    );
    expect(afterOfficial[0]?.count).toBe(beforeOfficial[0]?.count);

    const reopened = await reopenResearchTask(
      testDb.client.sql,
      review.taskId,
      { type: "human", id: ownerId },
    );
    expect(reopened.status).toBe("in_progress");
    expect(
      await testDb.client.sql.unsafe(
        `select id from research_events
         where event_type = 'RESEARCH_TASK_COMPLETED'
           and payload->>'submissionId' = $1`,
        [review.submissionId],
      ),
    ).toHaveLength(1);
  });

  it("requests changes without rewriting the old submission and requires a new review cycle", async () => {
    const review = await createPendingReview("Changes requested");

    await expect(
      requestSubmissionChanges(
        testDb.client.sql,
        review.reviewRequestId,
        "   ",
        { type: "human", id: reviewerAId },
      ),
    ).rejects.toThrow(/comment|required/i);

    await expect(
      requestSubmissionChanges(
        testDb.client.sql,
        review.reviewRequestId,
        "x".repeat(4_001),
        { type: "human", id: reviewerAId },
      ),
    ).rejects.toThrow(/comment|4000/i);

    const changed = await requestSubmissionChanges(
      testDb.client.sql,
      review.reviewRequestId,
      "Please revise the analysis",
      { type: "human", id: reviewerAId },
    );
    expect(changed.status).toBe("changes_requested");

    const oldRows = await testDb.client.sql.unsafe(
      `select ts.submission_number, rr.status
       from task_submissions ts
       join review_requests rr on rr.task_submission_id = ts.id
       where ts.id = $1`,
      [review.submissionId],
    );
    expect(oldRows).toEqual([
      { submission_number: 1, status: "changes_requested" },
    ]);

    const taskRows = await testDb.client.sql.unsafe(
      "select status from research_tasks where id = $1",
      [review.taskId],
    );
    expect(taskRows[0]?.status).toBe("in_progress");

    const second = await submitResearchTask(
      testDb.client.sql,
      review.taskId,
      {
        summary: "Revised delivery",
        reviewerMemberId: reviewerAId,
      },
      { type: "human", id: ownerId },
    );
    expect(second.submission.submissionNumber).toBe(2);
    expect(second.reviewRequestId).toBeTruthy();
    expect(second.reviewRequestId).not.toBe(review.reviewRequestId);

    const preserved = await testDb.client.sql.unsafe(
      `select status from review_requests where id = $1`,
      [review.reviewRequestId],
    );
    expect(preserved[0]?.status).toBe("changes_requested");
  });

  it("rejects a submission with a reason but keeps the task available for revision", async () => {
    const review = await createPendingReview("Rejected delivery");

    await expect(
      rejectSubmission(
        testDb.client.sql,
        review.reviewRequestId,
        "",
        { type: "human", id: reviewerAId },
      ),
    ).rejects.toThrow(/comment|required/i);

    const rejected = await rejectSubmission(
      testDb.client.sql,
      review.reviewRequestId,
      "The evidence does not support this delivery",
      { type: "human", id: reviewerAId },
    );
    expect(rejected.status).toBe("rejected");

    const taskRows = await testDb.client.sql.unsafe(
      "select status from research_tasks where id = $1",
      [review.taskId],
    );
    expect(taskRows[0]?.status).toBe("in_progress");
  });

  it("rechecks current reviewer eligibility at decision time", async () => {
    const staleReview = await createPendingReview("Stale reviewer action");
    await testDb.client.sql.unsafe(
      "update members set active = false where id = $1",
      [reviewerAId],
    );
    try {
      await expect(
        approveSubmission(
          testDb.client.sql,
          staleReview.reviewRequestId,
          null,
          { type: "human", id: reviewerAId },
        ),
      ).rejects.toThrow(/reviewer|active|access|forbidden/i);
    } finally {
      await testDb.client.sql.unsafe(
        "update members set active = true where id = $1",
        [reviewerAId],
      );
    }

    const selfReview = await createPendingReview("Late contributor conflict");
    await testDb.client.sql.unsafe(
      `insert into task_submission_contributors
        (id, submission_id, contributor_kind, contributor_ref)
       values ('late-reviewer-conflict', $1, 'human_member', $2)`,
      [selfReview.submissionId, reviewerAId],
    );
    await expect(
      approveSubmission(
        testDb.client.sql,
        selfReview.reviewRequestId,
        null,
        { type: "human", id: reviewerAId },
      ),
    ).rejects.toThrow(/contribut|self|review/i);
  });

  it("cancels a pending review and task atomically but blocks cancellation while awaiting a scientific decision", async () => {
    const pending = await createPendingReview("Cancel pending review");
    const cancelled = await cancelResearchTask(
      testDb.client.sql,
      pending.taskId,
      { type: "human", id: ownerId },
    );
    expect(cancelled.status).toBe("cancelled");

    const pendingRows = await testDb.client.sql.unsafe(
      "select status from review_requests where id = $1",
      [pending.reviewRequestId],
    );
    expect(pendingRows[0]?.status).toBe("cancelled");

    const cancelActions = await testDb.client.sql.unsafe(
      `select action, actor_id, resulting_status
       from review_actions
       where review_request_id = $1 and action = 'cancel'`,
      [pending.reviewRequestId],
    );
    expect(cancelActions).toEqual([
      {
        action: "cancel",
        actor_id: ownerId,
        resulting_status: "cancelled",
      },
    ]);

    for (const eventType of ["REVIEW_CANCELLED", "RESEARCH_TASK_CANCELLED"]) {
      const rows = await testDb.client.sql.unsafe(
        `select id from research_events
         where project_id = $1
           and event_type = $2
           and payload->>'researchTaskId' = $3`,
        [projectId, eventType, pending.taskId],
      );
      expect(rows).toHaveLength(1);
    }

    const escalated = await createPendingReview("Cannot cancel during decision");
    await testDb.client.sql.unsafe(
      `update review_requests
       set status = 'awaiting_scientific_decision', updated_at = now()
       where id = $1`,
      [escalated.reviewRequestId],
    );

    await expect(
      cancelResearchTask(
        testDb.client.sql,
        escalated.taskId,
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/scientific|decision|review/i);

    const [taskRows, reviewRows] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [escalated.taskId],
      ),
      testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [escalated.reviewRequestId],
      ),
    ]);
    expect(taskRows[0]?.status).toBe("awaiting_review");
    expect(reviewRows[0]?.status).toBe("awaiting_scientific_decision");
  });

});
