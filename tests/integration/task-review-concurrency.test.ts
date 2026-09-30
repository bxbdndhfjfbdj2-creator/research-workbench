import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  createResearchTask,
  startResearchTask,
  updateResearchTaskRequirements,
} from "../../packages/application/src/tasks/research-task-service";
import { submitResearchTask } from "../../packages/application/src/tasks/task-submission-service";
import { approveSubmission } from "../../packages/application/src/tasks/task-review-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("task submission concurrency", () => {
  let testDb: TestDatabase;
  const projectId = "task-concurrency-project";
  const ownerId = "task-concurrency-owner";
  const reviewerId = "task-concurrency-reviewer";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('task-concurrency-team', 'Task Concurrency Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values
        ($1, 'task-concurrency-team', 'owner@task-concurrency.test', 'Owner', 'lead', 'human'),
        ($2, 'task-concurrency-team', 'reviewer@task-concurrency.test', 'Reviewer', 'researcher', 'human')`,
      [ownerId, reviewerId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('task-concurrency-portfolio', 'task-concurrency-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, 'task-concurrency-portfolio', 'Concurrency Project', $2)",
      [projectId, ownerId],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('task-concurrency-reviewer-membership', $1, $2, 'collaborator')`,
      [projectId, reviewerId],
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function createStartedTask(
    title: string,
    reviewPolicy: "none" | "required",
  ) {
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      {
        title,
        description: "Old description",
        acceptanceCriteria: ["Old criterion"],
        reviewPolicy,
      },
      { type: "human", id: ownerId },
    );
    return startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: ownerId },
    );
  }

  it("serializes concurrent required submissions so only one active review cycle is created", async () => {
    const task = await createStartedTask("Concurrent required submit", "required");

    const outcomes = await Promise.allSettled([
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "First candidate", reviewerMemberId: reviewerId },
        { type: "human", id: ownerId },
      ),
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "Second candidate", reviewerMemberId: reviewerId },
        { type: "human", id: ownerId },
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const submissions = await testDb.client.sql.unsafe(
      `select submission_number from task_submissions
       where research_task_id = $1 order by submission_number`,
      [task.id],
    );
    expect(submissions).toEqual([{ submission_number: 1 }]);

    const reviews = await testDb.client.sql.unsafe(
      `select rr.id
       from review_requests rr
       join task_submissions ts on ts.id = rr.task_submission_id
       where ts.research_task_id = $1`,
      [task.id],
    );
    expect(reviews).toHaveLength(1);
  });

  it("freezes either the complete old or complete new requirement set when update races submit", async () => {
    const task = await createStartedTask("Requirement race old", "none");

    const outcomes = await Promise.allSettled([
      updateResearchTaskRequirements(
        testDb.client.sql,
        task.id,
        {
          title: "Requirement race new",
          description: "New description",
          acceptanceCriteria: ["New criterion"],
        },
        { type: "human", id: ownerId },
      ),
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "Race delivery" },
        { type: "human", id: ownerId },
      ),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);

    const rows = await testDb.client.sql.unsafe(
      "select requirement_snapshot from task_submissions where research_task_id = $1",
      [task.id],
    );
    expect(rows).toHaveLength(1);

    const snapshot = rows[0]?.requirement_snapshot;
    expect([
      {
        title: "Requirement race old",
        description: "Old description",
        acceptanceCriteria: ["Old criterion"],
        executionMode: "human",
        reviewPolicy: "none",
      },
      {
        title: "Requirement race new",
        description: "New description",
        acceptanceCriteria: ["New criterion"],
        executionMode: "human",
        reviewPolicy: "none",
      },
    ]).toContainEqual(snapshot);
  });

  it("serializes concurrent approve attempts into one terminal review and one completion fact", async () => {
    const task = await createStartedTask("Concurrent approve", "required");
    const submitted = await submitResearchTask(
      testDb.client.sql,
      task.id,
      { summary: "Approve once", reviewerMemberId: reviewerId },
      { type: "human", id: ownerId },
    );
    if (!submitted.reviewRequestId) throw new Error("Expected review request");

    const outcomes = await Promise.allSettled([
      approveSubmission(
        testDb.client.sql,
        submitted.reviewRequestId,
        "Approve A",
        { type: "human", id: reviewerId },
      ),
      approveSubmission(
        testDb.client.sql,
        submitted.reviewRequestId,
        "Approve B",
        { type: "human", id: reviewerId },
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const [reviewActions, completionEvents, taskRows] = await Promise.all([
      testDb.client.sql.unsafe(
        `select id from review_actions
         where review_request_id = $1 and action = 'approve'`,
        [submitted.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        `select id from research_events
         where event_type = 'RESEARCH_TASK_COMPLETED'
           and payload->>'submissionId' = $1`,
        [submitted.submission.id],
      ),
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [task.id],
      ),
    ]);
    expect(reviewActions).toHaveLength(1);
    expect(completionEvents).toHaveLength(1);
    expect(taskRows[0]?.status).toBe("completed");
  });

});
