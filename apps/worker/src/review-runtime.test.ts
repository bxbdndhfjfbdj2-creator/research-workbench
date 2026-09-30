import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import { createWorkerDispatch } from "./main";
import { createReviewResolutionOutboxHandler } from "./review-runtime";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../tests/integration/support/postgres";

describe("review resolution worker", () => {
  let testDb: TestDatabase;
  const projectId = "review-worker-project";
  const reviewId = "review-worker-review";
  const decisionId = "review-worker-decision";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('review-worker-team', 'Review Worker Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values
        ('review-worker-owner', 'review-worker-team', 'owner@review-worker.test', 'Owner', 'lead', 'human'),
        ('review-worker-reviewer', 'review-worker-team', 'reviewer@review-worker.test', 'Reviewer', 'researcher', 'human')`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('review-worker-portfolio', 'review-worker-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values ($1, 'review-worker-portfolio', 'Review Worker Project', 'review-worker-owner')`,
      [projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('review-worker-reviewer-membership', $1, 'review-worker-reviewer', 'collaborator')`,
      [projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, execution_mode,
         review_policy, acceptance_criteria, workflow_version, created_by)
       values
        ('review-worker-task', $1, 'Worker task', 'awaiting_review', 'review-worker-owner',
         'human', 'required', '[]'::jsonb, 2, 'review-worker-owner')`,
      [projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into task_submissions
        (id, research_task_id, project_id, submission_number, summary,
         requirement_snapshot, requirement_snapshot_schema_version, submitted_by_member_id)
       values
        ('review-worker-submission', 'review-worker-task', $1, 1, 'Worker submission',
         '{}'::jsonb, 1, 'review-worker-owner')`,
      [projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into task_submission_contributors
        (id, submission_id, contributor_kind, contributor_ref)
       values
        ('review-worker-contributor', 'review-worker-submission', 'human_member', 'review-worker-owner')`,
    );
    await testDb.client.sql.unsafe(
      `insert into review_requests
        (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
       values
        ($1, $2, 'review-worker-submission', 'review-worker-reviewer',
         'awaiting_scientific_decision', 'review-worker-owner')`,
      [reviewId, projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into scientific_decisions
        (id, project_id, level, title, reason, evidence, impact, change_kind,
         status, proposed_by_type, proposed_by_id, decided_at)
       values
        ($1, $2, 'major', 'Worker decision', 'Resolve review',
         '[]'::jsonb, '[]'::jsonb, 'record_only', 'approved', 'human',
         'review-worker-reviewer', now())`,
      [decisionId, projectId],
    );
    await testDb.client.sql.unsafe(
      `insert into review_decision_links
        (id, review_request_id, scientific_decision_id, created_by_member_id)
       values
        ('review-worker-link', $1, $2, 'review-worker-reviewer')`,
      [reviewId, decisionId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("composes the resolution handler and resumes one terminal linked review idempotently", async () => {
    const handler = createReviewResolutionOutboxHandler(testDb.client.sql);
    const dispatch = createWorkerDispatch(handler);
    const record = {
      id: "review-worker-outbox",
      eventType: "scientific.decision.reviewed",
      payload: { projectId, decisionId, status: "approved" },
      attempts: 1,
    };

    await dispatch(record);
    await dispatch(record);

    const [reviewRows, actionRows] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [reviewId],
      ),
      testDb.client.sql.unsafe(
        `select id from review_actions
         where review_request_id = $1
           and action = 'scientific_decision_resolved'`,
        [reviewId],
      ),
    ]);
    expect(reviewRows[0]?.status).toBe("pending");
    expect(actionRows).toHaveLength(1);
  });

  it("recognizes unlinked reviewed-decision events as safe no-ops", async () => {
    const handler = createReviewResolutionOutboxHandler(testDb.client.sql);
    await expect(
      handler({
        id: "review-worker-unlinked",
        eventType: "scientific.decision.reviewed",
        payload: { projectId, decisionId: "unlinked-decision", status: "approved" },
        attempts: 1,
      }),
    ).resolves.toBe(true);

    await expect(
      handler({
        id: "review-worker-other",
        eventType: "research.task.created",
        payload: { projectId, researchTaskId: "task" },
        attempts: 1,
      }),
    ).resolves.toBe(false);
  });
});
