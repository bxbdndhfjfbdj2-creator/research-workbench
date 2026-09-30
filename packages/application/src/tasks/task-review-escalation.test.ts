import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  createResearchTask,
  startResearchTask,
} from "./research-task-service";
import { submitResearchTask } from "./task-submission-service";
import {
  escalateReviewToScientificDecision,
  resumeReviewAfterScientificDecision,
} from "./task-review-escalation";
import { reviewScientificDecision } from "../decisions/review-decision";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("task review scientific-decision escalation", () => {
  let testDb: TestDatabase;
  const teamId = "review-escalation-team";
  const portfolioId = "review-escalation-portfolio";
  const projectId = "review-escalation-project";
  const otherProjectId = "review-escalation-other-project";
  const projectLeadId = "review-escalation-project-lead";
  const orgLeadId = "review-escalation-org-lead";
  const ownerId = "review-escalation-owner";
  const reviewerId = "review-escalation-reviewer";
  const otherReviewerId = "review-escalation-other-reviewer";
  const revisionId = "review-escalation-revision";
  const otherRevisionId = "review-escalation-other-revision";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ($1, 'Review Escalation Team')",
      [teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ($1, $5, 'project-lead@escalation.test', 'Project Lead', 'researcher', 'human', true),
        ($2, $5, 'org-lead@escalation.test', 'Org Lead', 'lead', 'human', true),
        ($3, $5, 'owner@escalation.test', 'Owner', 'researcher', 'human', true),
        ($4, $5, 'reviewer@escalation.test', 'Reviewer', 'researcher', 'human', true),
        ('review-escalation-other-reviewer', $5, 'other-reviewer@escalation.test', 'Other Reviewer', 'researcher', 'human', true)`,
      [projectLeadId, orgLeadId, ownerId, reviewerId, teamId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ($1, $2, 'Escalation Portfolio')",
      [portfolioId, teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values
        ($1, $3, 'Escalation Project', $4),
        ($2, $3, 'Other Escalation Project', $4)`,
      [projectId, otherProjectId, portfolioId, projectLeadId],
    );
    for (const [id, memberId, role] of [
      ["review-escalation-project-lead-membership", projectLeadId, "lead"],
      ["review-escalation-owner-membership", ownerId, "collaborator"],
      ["review-escalation-reviewer-membership", reviewerId, "collaborator"],
      ["review-escalation-other-reviewer-membership", otherReviewerId, "collaborator"],
    ] as const) {
      await testDb.client.sql.unsafe(
        `insert into project_memberships (id, project_id, member_id, role)
         values ($1, $2, $3, $4)`,
        [id, projectId, memberId, role],
      );
    }

    await testDb.client.sql.unsafe(
      `insert into research_nodes (id, project_id, type, title)
       values
        ('review-escalation-node', $1, '理论', 'Escalation node'),
        ('review-escalation-other-node', $2, '理论', 'Other escalation node')`,
      [projectId, otherProjectId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_node_revisions
        (id, node_id, revision_number, content, status, created_by_type, created_by_id)
       values
        ($1, 'review-escalation-node', 1, '{}'::jsonb, '候选', 'human', $3),
        ($2, 'review-escalation-other-node', 1, '{}'::jsonb, '候选', 'human', $3)`,
      [revisionId, otherRevisionId, projectLeadId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createPendingReview(title: string) {
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title, reviewPolicy: "required" },
      { type: "human", id: ownerId },
    );
    await startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: ownerId },
    );
    const submitted = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: "Escalation candidate",
        reviewerMemberId: reviewerId,
      },
      { type: "human", id: ownerId },
    );
    if (!submitted.reviewRequestId) throw new Error("Expected review request");
    return {
      taskId: task.id,
      submissionId: submitted.submission.id,
      reviewRequestId: submitted.reviewRequestId,
    };
  }

  const majorRecordOnly = (title: string) => ({
    level: "major" as const,
    title,
    reason: "The reviewer identified a formal scientific governance question",
    evidence: [],
    impact: ["reviewed deliverable"],
    change: { kind: "record_only" as const },
  });

  it("allows only the current human reviewer to escalate and atomically links the decision", async () => {
    const review = await createPendingReview("Reviewer-only escalation");

    await expect(
      escalateReviewToScientificDecision(
        testDb.client.sql,
        review.reviewRequestId,
        majorRecordOnly("Wrong reviewer escalation"),
        { type: "human", id: otherReviewerId },
      ),
    ).rejects.toThrow(/reviewer|assigned|forbidden/i);

    await expect(
      escalateReviewToScientificDecision(
        testDb.client.sql,
        review.reviewRequestId,
        majorRecordOnly("Agent escalation"),
        { type: "agent", id: "review-agent" },
      ),
    ).rejects.toThrow(/human/i);

    const escalated = await escalateReviewToScientificDecision(
      testDb.client.sql,
      review.reviewRequestId,
      majorRecordOnly("Escalated scientific question"),
      { type: "human", id: reviewerId },
    );
    expect(escalated.review.status).toBe("awaiting_scientific_decision");
    expect(escalated.decision).toMatchObject({
      projectId,
      status: "proposed",
      level: "major",
      proposedBy: { type: "human", id: reviewerId },
    });

    const [taskRows, linkRows, actionRows] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [review.taskId],
      ),
      testDb.client.sql.unsafe(
        `select review_request_id, scientific_decision_id, created_by_member_id
         from review_decision_links where review_request_id = $1`,
        [review.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        `select action, actor_id, resulting_status
         from review_actions
         where review_request_id = $1
           and action = 'escalate_to_scientific_decision'`,
        [review.reviewRequestId],
      ),
    ]);
    expect(taskRows[0]?.status).toBe("awaiting_review");
    expect(linkRows).toEqual([
      {
        review_request_id: review.reviewRequestId,
        scientific_decision_id: escalated.decision.id,
        created_by_member_id: reviewerId,
      },
    ]);
    expect(actionRows).toEqual([
      {
        action: "escalate_to_scientific_decision",
        actor_id: reviewerId,
        resulting_status: "awaiting_scientific_decision",
      },
    ]);
  });

  it("serializes concurrent escalation so only one unresolved decision is created", async () => {
    const review = await createPendingReview("Concurrent escalation");
    const outcomes = await Promise.allSettled([
      escalateReviewToScientificDecision(
        testDb.client.sql,
        review.reviewRequestId,
        majorRecordOnly("Concurrent decision A"),
        { type: "human", id: reviewerId },
      ),
      escalateReviewToScientificDecision(
        testDb.client.sql,
        review.reviewRequestId,
        majorRecordOnly("Concurrent decision B"),
        { type: "human", id: reviewerId },
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const links = await testDb.client.sql.unsafe(
      "select scientific_decision_id from review_decision_links where review_request_id = $1",
      [review.reviewRequestId],
    );
    expect(links).toHaveLength(1);
  });

  it("reuses ScientificDecision validation for official-revision proposals", async () => {
    const invalidLevel = await createPendingReview("Invalid decision level");
    await expect(
      escalateReviewToScientificDecision(
        testDb.client.sql,
        invalidLevel.reviewRequestId,
        {
          level: "general",
          title: "Invalid official revision",
          reason: "Official changes must remain major decisions",
          evidence: [],
          impact: ["正式理论"],
          change: {
            kind: "official_revision",
            slot: "正式理论",
            revisionId,
          },
        },
        { type: "human", id: reviewerId },
      ),
    ).rejects.toThrow(/major/i);

    const crossProject = await createPendingReview("Cross-project revision");
    await expect(
      escalateReviewToScientificDecision(
        testDb.client.sql,
        crossProject.reviewRequestId,
        {
          level: "major",
          title: "Cross-project official revision",
          reason: "Must fail closed",
          evidence: [],
          impact: ["正式理论"],
          change: {
            kind: "official_revision",
            slot: "正式理论",
            revisionId: otherRevisionId,
          },
        },
        { type: "human", id: reviewerId },
      ),
    ).rejects.toThrow(/project|revision/i);

    for (const reviewRequestId of [
      invalidLevel.reviewRequestId,
      crossProject.reviewRequestId,
    ]) {
      const rows = await testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [reviewRequestId],
      );
      expect(rows[0]?.status).toBe("pending");
      const links = await testDb.client.sql.unsafe(
        "select id from review_decision_links where review_request_id = $1",
        [reviewRequestId],
      );
      expect(links).toHaveLength(0);
    }
  });

  it("resumes ordinary review only after an approved major decision becomes terminal", async () => {
    const review = await createPendingReview("Terminal approval");
    const escalated = await escalateReviewToScientificDecision(
      testDb.client.sql,
      review.reviewRequestId,
      majorRecordOnly("Major terminal approval"),
      { type: "human", id: reviewerId },
    );

    const projectLeadReview = await reviewScientificDecision(
      testDb.client.sql,
      escalated.decision.id,
      "approve",
      { type: "human", id: projectLeadId },
    );
    expect(projectLeadReview.status).toBe("awaiting_lead");
    expect(
      await resumeReviewAfterScientificDecision(
        testDb.client.sql,
        escalated.decision.id,
      ),
    ).toBe("not_terminal");

    const waitingRows = await testDb.client.sql.unsafe(
      "select status from review_requests where id = $1",
      [review.reviewRequestId],
    );
    expect(waitingRows[0]?.status).toBe("awaiting_scientific_decision");

    const approvedDecision = await reviewScientificDecision(
      testDb.client.sql,
      escalated.decision.id,
      "approve",
      { type: "human", id: orgLeadId },
    );
    expect(approvedDecision.status).toBe("approved");

    expect(
      await resumeReviewAfterScientificDecision(
        testDb.client.sql,
        escalated.decision.id,
      ),
    ).toBe("resumed");
    expect(
      await resumeReviewAfterScientificDecision(
        testDb.client.sql,
        escalated.decision.id,
      ),
    ).toBe("already_resolved");

    const [reviewRows, taskRows, resolutionActions] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [review.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [review.taskId],
      ),
      testDb.client.sql.unsafe(
        `select action from review_actions
         where review_request_id = $1
           and action = 'scientific_decision_resolved'`,
        [review.reviewRequestId],
      ),
    ]);
    expect(reviewRows[0]?.status).toBe("pending");
    expect(taskRows[0]?.status).toBe("awaiting_review");
    expect(resolutionActions).toHaveLength(1);
  });

  it("keeps review pending after terminal rejection rather than rejecting the submission", async () => {
    const review = await createPendingReview("Terminal rejection");
    const escalated = await escalateReviewToScientificDecision(
      testDb.client.sql,
      review.reviewRequestId,
      majorRecordOnly("Rejected scientific proposal"),
      { type: "human", id: reviewerId },
    );
    const rejected = await reviewScientificDecision(
      testDb.client.sql,
      escalated.decision.id,
      "reject",
      { type: "human", id: projectLeadId },
    );
    expect(rejected.status).toBe("rejected");

    expect(
      await resumeReviewAfterScientificDecision(
        testDb.client.sql,
        escalated.decision.id,
      ),
    ).toBe("resumed");

    const [reviewRows, taskRows] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [review.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [review.taskId],
      ),
    ]);
    expect(reviewRows[0]?.status).toBe("pending");
    expect(taskRows[0]?.status).toBe("awaiting_review");
  });

  it("does not resume review from needs_evidence", async () => {
    const review = await createPendingReview("Needs evidence");
    const escalated = await escalateReviewToScientificDecision(
      testDb.client.sql,
      review.reviewRequestId,
      majorRecordOnly("Evidence requested"),
      { type: "human", id: reviewerId },
    );
    const needsEvidence = await reviewScientificDecision(
      testDb.client.sql,
      escalated.decision.id,
      "request_evidence",
      { type: "human", id: projectLeadId },
    );
    expect(needsEvidence.status).toBe("needs_evidence");
    expect(
      await resumeReviewAfterScientificDecision(
        testDb.client.sql,
        escalated.decision.id,
      ),
    ).toBe("not_terminal");
  });
});
