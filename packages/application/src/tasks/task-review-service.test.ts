import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  createResearchTask,
  startResearchTask,
} from "./research-task-service";
import { submitResearchTask } from "./task-submission-service";
import { reassignReviewer } from "./task-review-service";
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
});
