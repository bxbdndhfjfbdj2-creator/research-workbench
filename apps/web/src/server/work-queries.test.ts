import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

vi.mock("server-only", () => ({}));

describe("research work read models", () => {
  let testDb: TestDatabase;
  let workQueries: typeof import("./work-queries");

  const member = {
    id: "work-query-reviewer",
    teamId: "work-query-team",
    displayName: "Reviewer",
    organizationRole: "researcher" as const,
  };

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    process.env.DATABASE_URL = testDb.container.getConnectionUri();

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('work-query-team', 'Work Query Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ('work-query-lead', 'work-query-team', 'lead@work.test', 'Lead', 'researcher', 'human', true),
        ('work-query-owner', 'work-query-team', 'owner@work.test', 'Owner', 'researcher', 'human', true),
        ('work-query-reviewer', 'work-query-team', 'reviewer@work.test', 'Reviewer', 'researcher', 'human', true),
        ('work-query-other-reviewer', 'work-query-team', 'other-reviewer@work.test', 'Other Reviewer', 'researcher', 'human', true),
        ('work-query-hidden-lead', 'work-query-team', 'hidden@work.test', 'Hidden Lead', 'researcher', 'human', true)`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('work-query-portfolio', 'work-query-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values
        ('work-query-project', 'work-query-portfolio', 'Visible Project', 'work-query-lead'),
        ('work-query-hidden-project', 'work-query-portfolio', 'Hidden Project', 'work-query-hidden-lead')`,
    );
    for (const [id, projectId, memberId, role] of [
      ["work-lead-membership", "work-query-project", "work-query-lead", "lead"],
      ["work-owner-membership", "work-query-project", "work-query-owner", "collaborator"],
      ["work-reviewer-membership", "work-query-project", "work-query-reviewer", "collaborator"],
      ["work-other-reviewer-membership", "work-query-project", "work-query-other-reviewer", "collaborator"],
      ["work-hidden-lead-membership", "work-query-hidden-project", "work-query-hidden-lead", "lead"],
    ] as const) {
      await testDb.client.sql.unsafe(
        "insert into project_memberships (id, project_id, member_id, role) values ($1, $2, $3, $4)",
        [id, projectId, memberId, role],
      );
    }

    await seedVisibleWork(testDb);
    await seedInboxEdges(testDb);

    workQueries = await import("./work-queries");
  }, 120_000);

  afterAll(async () => {
    const queries = await import("./queries");
    await queries.getWebDbClient().close();
    delete process.env.DATABASE_URL;
    if (testDb) await stopTestDatabase(testDb);
  });

  it("returns project work only when the member can read the project", async () => {
    const visible = await workQueries.getProjectResearchWork(
      member,
      "work-query-project",
    );
    expect(visible).not.toBeNull();
    expect(visible!.tasks.find((task) => task.id === "work-task")).toEqual(
      expect.objectContaining({
        id: "work-task",
        title: "Hybrid analysis",
        status: "awaiting_review",
        owner: { id: "work-query-owner", displayName: "Owner" },
        executionMode: "hybrid",
        reviewPolicy: "required",
        latestSubmission: expect.objectContaining({
          id: "work-submission-2",
          submissionNumber: 2,
        }),
        currentReview: expect.objectContaining({
          id: "work-review-2",
          reviewerMemberId: "work-query-reviewer",
          status: "pending",
        }),
        agentRunCount: 1,
        latestAgentRunState: "完成",
      }),
    );

    await expect(
      workQueries.getProjectResearchWork(member, "work-query-hidden-project"),
    ).resolves.toBeNull();
  });

  it("preserves submission/review history and hybrid provenance in task detail", async () => {
    const detail = await workQueries.getResearchTaskDetail(member, "work-task");
    expect(detail).not.toBeNull();
    expect(detail!.submissions.map((submission) => submission.submissionNumber))
      .toEqual([1, 2]);
    expect(detail!.submissions[0]?.review?.status).toBe("changes_requested");
    expect(detail!.submissions[1]?.review?.status).toBe("pending");

    expect(detail!.submissions[1]?.contributors).toEqual([
      { kind: "agent_run", id: "work-agent-run", displayName: "Agent run #1" },
      { kind: "human_member", id: "work-query-owner", displayName: "Owner" },
    ]);
    expect(detail!.submissions[1]?.refs).toContainEqual({
      kind: "agent_run",
      id: "work-agent-run",
      relation: "context",
      label: "Agent run #1",
      accessClass: null,
      versionNumber: null,
    });
  });

  it("projects restricted FileVersion provenance without locator or access-policy metadata", async () => {
    const detail = await workQueries.getResearchTaskDetail(member, "work-task");
    const restricted = detail!.submissions[1]?.refs.find(
      (ref) => ref.id === "work-restricted-version",
    );
    expect(restricted).toEqual({
      kind: "file_version",
      id: "work-restricted-version",
      relation: "source",
      label: "Restricted dataset",
      accessClass: "restricted",
      versionNumber: 1,
    });
    expect(restricted).not.toHaveProperty("uriOrLocator");
    expect(restricted).not.toHaveProperty("accessPolicyRef");

    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("secure-datalake://work-query/private");
    expect(serialized).not.toContain("policy:work-query-private");
  });

  it("shows only my visible active reviews and marks scientific-decision waits non-actionable", async () => {
    const inbox = await workQueries.listMyReviewInbox(member);
    expect(inbox.map((item) => item.id).sort()).toEqual([
      "work-review-2",
      "work-review-awaiting-decision",
    ]);
    expect(
      inbox.find((item) => item.id === "work-review-2"),
    ).toMatchObject({
      projectId: "work-query-project",
      projectTitle: "Visible Project",
      taskId: "work-task",
      taskTitle: "Hybrid analysis",
      submissionNumber: 2,
      submitterName: "Owner",
      status: "pending",
      actionable: true,
    });
    expect(
      inbox.find((item) => item.id === "work-review-awaiting-decision"),
    ).toMatchObject({
      status: "awaiting_scientific_decision",
      actionable: false,
    });
  });
});

async function seedVisibleWork(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql.unsafe(
    `insert into research_tasks
      (id, project_id, title, description, status, assignee_member_id,
       execution_mode, review_policy, acceptance_criteria, workflow_version, created_by)
     values
      ('work-task', 'work-query-project', 'Hybrid analysis', 'Run robustness checks',
       'awaiting_review', 'work-query-owner', 'hybrid', 'required',
       '["attach stable output"]'::jsonb, 2, 'work-query-owner')`,
  );

  await testDb.client.sql.unsafe(
    `insert into agent_tasks
      (id, research_task_id, project_id, request, created_by_type, created_by_id)
     values
      ('work-agent-task', 'work-task', 'work-query-project',
       '{"objective":"robustness"}'::jsonb, 'human', 'work-query-owner')`,
  );
  await testDb.client.sql.unsafe(
    `insert into agent_context_snapshots
      (id, project_id, asset_version_refs, skill_version_refs, harness_version,
       harness_profile, runtime_profile, model_route, sandbox_policy,
       tool_allowlist, subagent_allowlist, created_by_type, created_by_id)
     values
      ('work-agent-snapshot', 'work-query-project', '[]'::jsonb, '[]'::jsonb,
       'test-harness', 'default', 'default', 'test-model', 'read-only',
       '[]'::jsonb, '[]'::jsonb, 'human', 'work-query-owner')`,
  );
  await testDb.client.sql.unsafe(
    `insert into agent_runs
      (id, agent_task_id, project_id, attempt_number, context_snapshot_id,
       state, execution_policy, created_by_type, created_by_id)
     values
      ('work-agent-run', 'work-agent-task', 'work-query-project', 1,
       'work-agent-snapshot', '完成', '{}'::jsonb, 'human', 'work-query-owner')`,
  );

  await testDb.client.sql.unsafe(
    `insert into task_submissions
      (id, research_task_id, project_id, submission_number, summary,
       requirement_snapshot, requirement_snapshot_schema_version, submitted_by_member_id, created_at)
     values
      ('work-submission-1', 'work-task', 'work-query-project', 1, 'First attempt',
       '{"title":"Hybrid analysis","description":"Run robustness checks","acceptanceCriteria":["attach stable output"],"executionMode":"hybrid","reviewPolicy":"required"}'::jsonb,
       1, 'work-query-owner', now() - interval '2 hours'),
      ('work-submission-2', 'work-task', 'work-query-project', 2, 'Revised attempt',
       '{"title":"Hybrid analysis","description":"Run robustness checks","acceptanceCriteria":["attach stable output"],"executionMode":"hybrid","reviewPolicy":"required"}'::jsonb,
       1, 'work-query-owner', now() - interval '1 hour')`,
  );
  await testDb.client.sql.unsafe(
    `insert into task_submission_contributors
      (id, submission_id, contributor_kind, contributor_ref)
     values
      ('work-contributor-owner-1', 'work-submission-1', 'human_member', 'work-query-owner'),
      ('work-contributor-owner-2', 'work-submission-2', 'human_member', 'work-query-owner'),
      ('work-contributor-agent-2', 'work-submission-2', 'agent_run', 'work-agent-run')`,
  );

  await testDb.client.sql.unsafe(
    `insert into research_files
      (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
     values
      ('work-restricted-file', 'work-query-project', 'Restricted dataset',
       'dataset', 'restricted', 'active', 'work-query-owner')`,
  );
  await testDb.client.sql.unsafe(
    `insert into external_data_references
      (id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
       version_label, created_by)
     values
      ('work-restricted-reference', 'work-query-project',
       'secure-datalake://work-query/private', 'manifest-work',
       'policy:work-query-private', 'v1', 'work-query-owner')`,
  );
  await testDb.client.sql.unsafe(
    `insert into file_versions
      (id, research_file_id, version_number, external_reference_id, original_filename,
       source_kind, source_metadata, scan_status, parse_status, created_by)
     values
      ('work-restricted-version', 'work-restricted-file', 1, 'work-restricted-reference',
       'restricted.dataset', 'external_reference', '{}'::jsonb,
       'not_applicable', 'not_applicable', 'work-query-owner')`,
  );
  await testDb.client.sql.unsafe(
    `insert into task_submission_refs
      (id, submission_id, ref_kind, ref_id, relation)
     values
      ('work-ref-file', 'work-submission-2', 'file_version', 'work-restricted-version', 'source'),
      ('work-ref-agent', 'work-submission-2', 'agent_run', 'work-agent-run', 'context')`,
  );

  await testDb.client.sql.unsafe(
    `insert into review_requests
      (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id, created_at)
     values
      ('work-review-1', 'work-query-project', 'work-submission-1',
       'work-query-reviewer', 'changes_requested', 'work-query-owner', now() - interval '110 minutes'),
      ('work-review-2', 'work-query-project', 'work-submission-2',
       'work-query-reviewer', 'pending', 'work-query-owner', now() - interval '50 minutes')`,
  );
}

async function seedInboxEdges(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql.unsafe(
    `insert into research_tasks
      (id, project_id, title, status, assignee_member_id,
       execution_mode, review_policy, acceptance_criteria, workflow_version, created_by)
     values
      ('work-wait-task', 'work-query-project', 'Awaiting decision', 'awaiting_review',
       'work-query-owner', 'human', 'required', '[]'::jsonb, 2, 'work-query-owner'),
      ('work-other-reviewer-task', 'work-query-project', 'Someone else review', 'awaiting_review',
       'work-query-owner', 'human', 'required', '[]'::jsonb, 2, 'work-query-owner'),
      ('work-hidden-task', 'work-query-hidden-project', 'Hidden review', 'awaiting_review',
       'work-query-hidden-lead', 'human', 'required', '[]'::jsonb, 2, 'work-query-hidden-lead')`,
  );
  await testDb.client.sql.unsafe(
    `insert into task_submissions
      (id, research_task_id, project_id, submission_number, summary,
       requirement_snapshot, requirement_snapshot_schema_version, submitted_by_member_id)
     values
      ('work-wait-submission', 'work-wait-task', 'work-query-project', 1, 'Waiting',
       '{}'::jsonb, 1, 'work-query-owner'),
      ('work-other-reviewer-submission', 'work-other-reviewer-task', 'work-query-project', 1, 'Other',
       '{}'::jsonb, 1, 'work-query-owner'),
      ('work-hidden-submission', 'work-hidden-task', 'work-query-hidden-project', 1, 'Hidden',
       '{}'::jsonb, 1, 'work-query-hidden-lead')`,
  );
  await testDb.client.sql.unsafe(
    `insert into review_requests
      (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
     values
      ('work-review-awaiting-decision', 'work-query-project', 'work-wait-submission',
       'work-query-reviewer', 'awaiting_scientific_decision', 'work-query-owner'),
      ('work-review-other-reviewer', 'work-query-project', 'work-other-reviewer-submission',
       'work-query-other-reviewer', 'pending', 'work-query-owner'),
      ('work-review-hidden', 'work-query-hidden-project', 'work-hidden-submission',
       'work-query-reviewer', 'pending', 'work-query-hidden-lead')`,
  );
}
