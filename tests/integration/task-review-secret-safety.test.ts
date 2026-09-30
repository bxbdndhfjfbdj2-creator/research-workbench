import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  createResearchTask,
  startResearchTask,
} from "../../packages/application/src/tasks/research-task-service";
import { submitResearchTask } from "../../packages/application/src/tasks/task-submission-service";
import { requestSubmissionChanges } from "../../packages/application/src/tasks/task-review-service";
import { escalateReviewToScientificDecision } from "../../packages/application/src/tasks/task-review-escalation";
import { markOutboxFailed } from "../../packages/queue/src/outbox-dispatcher";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("phase 4B task/review secret safety", () => {
  let testDb: TestDatabase;
  const teamId = "task-secret-team";
  const portfolioId = "task-secret-portfolio";
  const projectId = "task-secret-project";
  const ownerId = "task-secret-owner";
  const reviewerId = "task-secret-reviewer";
  const restrictedLocator = "secure-datalake://phase4b/private";
  const restrictedPolicy = "policy:phase4b-private";
  const restrictedVersionId = "task-secret-file-version";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ($1, 'Task Secret Team')",
      [teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ($1, $3, 'owner@task-secret.test', 'Owner', 'lead', 'human', true),
        ($2, $3, 'reviewer@task-secret.test', 'Reviewer', 'researcher', 'human', true)`,
      [ownerId, reviewerId, teamId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ($1, $2, 'Secret Portfolio')",
      [portfolioId, teamId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ($1, $2, 'Secret Project', $3)",
      [projectId, portfolioId, ownerId],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('task-secret-reviewer-membership', $1, $2, 'collaborator')`,
      [projectId, reviewerId],
    );

    await testDb.client.sql.unsafe(
      `insert into external_data_references
        (id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
         version_label, created_by)
       values
        ('task-secret-external', $1, $2, 'task-secret-manifest', $3, 'v1', $4)`,
      [projectId, restrictedLocator, restrictedPolicy, ownerId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_files
        (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
       values
        ('task-secret-file', $1, 'Restricted source', 'dataset',
         'restricted', 'active', $2)`,
      [projectId, ownerId],
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, external_reference_id,
         original_filename, source_kind, source_metadata,
         scan_status, parse_status, created_by)
       values
        ($1, 'task-secret-file', 1, 'task-secret-external',
         'restricted.dataset', 'external_reference', '{}'::jsonb,
         'not_applicable', 'not_applicable', $2)`,
      [restrictedVersionId, ownerId],
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
      { title, reviewPolicy },
      { type: "human", id: ownerId },
    );
    await startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: ownerId },
    );
    return task;
  }

  it("fails closed when a corrupted requirement snapshot contains a credential-shaped key", async () => {
    const task = await createStartedTask("Corrupted secret snapshot", "none");
    await testDb.client.sql.unsafe(
      `update research_tasks
       set acceptance_criteria = '[{"accessKeyId":"AKIA-NOT-ALLOWED"}]'::jsonb
       where id = $1`,
      [task.id],
    );

    await expect(
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "Should not become formal" },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/sensitive|credential|accessKeyId/i);

    const [submissions, events, outbox] = await Promise.all([
      testDb.client.sql.unsafe(
        "select id from task_submissions where research_task_id = $1",
        [task.id],
      ),
      testDb.client.sql.unsafe(
        `select id from research_events
         where event_type = 'TASK_SUBMISSION_CREATED'
           and payload->>'researchTaskId' = $1`,
        [task.id],
      ),
      testDb.client.sql.unsafe(
        `select id from outbox_events
         where event_type = 'research.task.submission.created'
           and payload->>'researchTaskId' = $1`,
        [task.id],
      ),
    ]);
    expect(submissions).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(outbox).toHaveLength(0);
  });

  it("keeps submission summary and review comment out of ResearchEvent and Outbox payloads", async () => {
    const summaryMarker = "PRIVATE-SUBMISSION-TEXT-4B";
    const commentMarker = "PRIVATE-REVIEW-COMMENT-4B";
    const task = await createStartedTask("Free-text payload isolation", "required");
    const submitted = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: summaryMarker,
        reviewerMemberId: reviewerId,
      },
      { type: "human", id: ownerId },
    );
    if (!submitted.reviewRequestId) throw new Error("Expected review request");

    await requestSubmissionChanges(
      testDb.client.sql,
      submitted.reviewRequestId,
      commentMarker,
      { type: "human", id: reviewerId },
    );

    const [eventText, outboxText, actionRows, submissionRows] = await Promise.all([
      testDb.client.sql.unsafe(
        `select coalesce(string_agg(payload::text, ' '), '') as payload_text
         from research_events where project_id = $1`,
        [projectId],
      ),
      testDb.client.sql.unsafe(
        `select coalesce(string_agg(payload::text, ' '), '') as payload_text
         from outbox_events
         where payload->>'projectId' = $1`,
        [projectId],
      ),
      testDb.client.sql.unsafe(
        `select comment from review_actions
         where review_request_id = $1 and action = 'request_changes'`,
        [submitted.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        "select summary from task_submissions where id = $1",
        [submitted.submission.id],
      ),
    ]);

    expect(String(eventText[0]?.payload_text ?? "")).not.toContain(summaryMarker);
    expect(String(eventText[0]?.payload_text ?? "")).not.toContain(commentMarker);
    expect(String(outboxText[0]?.payload_text ?? "")).not.toContain(summaryMarker);
    expect(String(outboxText[0]?.payload_text ?? "")).not.toContain(commentMarker);
    expect(actionRows).toEqual([{ comment: commentMarker }]);
    expect(submissionRows).toEqual([{ summary: summaryMarker }]);
  });

  it("never copies restricted locator or access policy into 4B event/outbox payloads", async () => {
    const task = await createStartedTask("Restricted ref payload isolation", "none");
    const submitted = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: "Reference a restricted file safely",
        refs: [
          {
            kind: "file_version",
            refId: restrictedVersionId,
            relation: "source",
          },
        ],
      },
      { type: "human", id: ownerId },
    );

    const [eventRows, outboxRows, refRows] = await Promise.all([
      testDb.client.sql.unsafe(
        `select payload::text as payload_text
         from research_events
         where event_type = 'TASK_SUBMISSION_CREATED'
           and payload->>'taskSubmissionId' = $1`,
        [submitted.submission.id],
      ),
      testDb.client.sql.unsafe(
        `select payload::text as payload_text
         from outbox_events
         where event_type = 'research.task.submission.created'
           and payload->>'taskSubmissionId' = $1`,
        [submitted.submission.id],
      ),
      testDb.client.sql.unsafe(
        "select ref_kind, ref_id, relation from task_submission_refs where submission_id = $1",
        [submitted.submission.id],
      ),
    ]);

    expect(refRows).toEqual([
      {
        ref_kind: "file_version",
        ref_id: restrictedVersionId,
        relation: "source",
      },
    ]);
    const serialized = JSON.stringify([...eventRows, ...outboxRows]);
    expect(serialized).not.toContain(restrictedLocator);
    expect(serialized).not.toContain(restrictedPolicy);
  });

  it("rejects credential-shaped escalation payload fields before creating governance facts", async () => {
    const task = await createStartedTask("Escalation secret guard", "required");
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

    const unsafeProposal = {
      level: "major" as const,
      title: "Unsafe escalation",
      reason: "Structured payload guard regression",
      evidence: [
        {
          kind: "source",
          ref: "evidence-1",
          accessKeyId: "AKIA-NOT-ALLOWED",
        },
      ],
      impact: ["reviewed deliverable"],
      change: { kind: "record_only" as const },
    };

    await expect(
      escalateReviewToScientificDecision(
        testDb.client.sql,
        submitted.reviewRequestId,
        unsafeProposal as never,
        { type: "human", id: reviewerId },
      ),
    ).rejects.toThrow(/sensitive|credential|accessKeyId/i);

    const [links, reviews] = await Promise.all([
      testDb.client.sql.unsafe(
        "select id from review_decision_links where review_request_id = $1",
        [submitted.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        "select status from review_requests where id = $1",
        [submitted.reviewRequestId],
      ),
    ]);
    expect(links).toHaveLength(0);
    expect(reviews[0]?.status).toBe("pending");
  });

  it("stores a fixed safe outbox failure summary instead of the raw exception", async () => {
    const outboxId = "task-secret-outbox-failure";
    const rawError = "PRIVATE-ADAPTER-ERROR-WITH-LOCATOR";
    await testDb.client.sql.unsafe(
      `insert into outbox_events
        (id, event_type, payload, status, attempts, available_at)
       values ($1, 'task.secret.test', '{}'::jsonb, 'processing', 1, now())`,
      [outboxId],
    );

    await markOutboxFailed(
      testDb.client.sql,
      outboxId,
      new Error(rawError),
    );

    const rows = await testDb.client.sql.unsafe(
      "select status, last_error from outbox_events where id = $1",
      [outboxId],
    );
    expect(rows[0]).toEqual({
      status: "pending",
      last_error: "DispatchError",
    });
    expect(String(rows[0]?.last_error)).not.toContain(rawError);
  });
});
