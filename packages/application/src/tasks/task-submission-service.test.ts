import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  createResearchTask,
  setResearchTaskExecutionMode,
  startResearchTask,
  updateResearchTaskRequirements,
} from "./research-task-service";
import { submitResearchTask } from "./task-submission-service";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("task submission service", () => {
  let testDb: TestDatabase;
  const teamId = "submission-team";
  const portfolioId = "submission-portfolio";
  const projectId = "submission-project";
  const otherProjectId = "submission-other-project";
  const projectLeadId = "submission-project-lead";
  const ownerId = "submission-owner";
  const reviewerId = "submission-reviewer";
  const contributorId = "submission-contributor";
  const outsiderId = "submission-outsider";

  const fileVersionId = "submission-file-version";
  const otherFileVersionId = "submission-other-file-version";
  const resultId = "submission-result";
  const otherResultId = "submission-other-result";
  const revisionId = "submission-revision";
  const otherRevisionId = "submission-other-revision";
  const agentRunId = "submission-agent-run";
  const otherAgentRunId = "submission-other-agent-run";

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ($1, 'Submission Team')",
      [teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type, active)
       values
        ($1, $6, 'lead@submission.test', 'Project Lead', 'researcher', 'human', true),
        ($2, $6, 'owner@submission.test', 'Owner', 'researcher', 'human', true),
        ($3, $6, 'reviewer@submission.test', 'Reviewer', 'researcher', 'human', true),
        ($4, $6, 'contributor@submission.test', 'Contributor', 'researcher', 'human', true),
        ($5, $6, 'outsider@submission.test', 'Outsider', 'researcher', 'human', true)`,
      [projectLeadId, ownerId, reviewerId, contributorId, outsiderId, teamId],
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ($1, $2, 'Submission Portfolio')",
      [portfolioId, teamId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values
        ($1, $3, 'Submission Project', $4),
        ($2, $3, 'Other Project', $4)`,
      [projectId, otherProjectId, portfolioId, projectLeadId],
    );
    for (const [id, memberId, role] of [
      ["submission-owner-membership", ownerId, "collaborator"],
      ["submission-reviewer-membership", reviewerId, "collaborator"],
      ["submission-contributor-membership", contributorId, "collaborator"],
      ["submission-lead-membership", projectLeadId, "lead"],
    ] as const) {
      await testDb.client.sql.unsafe(
        `insert into project_memberships (id, project_id, member_id, role)
         values ($1, $2, $3, $4)`,
        [id, projectId, memberId, role],
      );
    }
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values ('submission-other-lead-membership', $1, $2, 'lead')`,
      [otherProjectId, projectLeadId],
    );

    await seedReferenceFixtures();
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  async function seedReferenceFixtures(): Promise<void> {
    await testDb.client.sql.unsafe(
      `insert into research_nodes (id, project_id, type, title)
       values
        ('submission-node', $1, '分析方案', 'Submission node'),
        ('submission-other-node', $2, '分析方案', 'Other node')`,
      [projectId, otherProjectId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_node_revisions
        (id, node_id, revision_number, content, status, created_by_type, created_by_id)
       values
        ($1, 'submission-node', 1, '{}'::jsonb, '候选', 'human', $3),
        ($2, 'submission-other-node', 1, '{}'::jsonb, '候选', 'human', $3)`,
      [revisionId, otherRevisionId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_results
        (id, project_id, data_version_ref, analysis_revision_id, execution_kind,
         run_ref, output_refs, created_by_type, created_by_id)
       values
        ($1, $3, 'data:a', $5, 'manual', 'submission-result-run', '[]'::jsonb, 'human', $7),
        ($2, $4, 'data:b', $6, 'manual', 'submission-other-result-run', '[]'::jsonb, 'human', $7)`,
      [
        resultId,
        otherResultId,
        projectId,
        otherProjectId,
        revisionId,
        otherRevisionId,
        projectLeadId,
      ],
    );

    await testDb.client.sql.unsafe(
      `insert into external_data_references
        (id, project_id, uri_or_locator, manifest_hash, access_policy_ref, version_label, created_by)
       values
        ('submission-external', $1, 'controlled://submission', 'manifest-a', 'policy-a', 'v1', $3),
        ('submission-other-external', $2, 'controlled://other', 'manifest-b', 'policy-b', 'v1', $3)`,
      [projectId, otherProjectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into research_files
        (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
       values
        ('submission-file', $1, 'Submission file', 'analysis_output', 'project', 'active', $3),
        ('submission-other-file', $2, 'Other file', 'analysis_output', 'project', 'active', $3)`,
      [projectId, otherProjectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, external_reference_id, original_filename,
         source_kind, source_metadata, scan_status, parse_status, created_by)
       values
        ($1, 'submission-file', 1, 'submission-external', 'submission.external',
         'external_reference', '{}'::jsonb, 'not_applicable', 'not_applicable', $3),
        ($2, 'submission-other-file', 1, 'submission-other-external', 'other.external',
         'external_reference', '{}'::jsonb, 'not_applicable', 'not_applicable', $3)`,
      [fileVersionId, otherFileVersionId, projectLeadId],
    );

    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, execution_mode,
         review_policy, acceptance_criteria, workflow_version, created_by)
       values
        ('submission-agent-task-parent', $1, 'Agent parent', 'in_progress', $3,
         'agent', 'none', '[]'::jsonb, 2, $3),
        ('submission-other-agent-task-parent', $2, 'Other agent parent', 'in_progress', $3,
         'agent', 'none', '[]'::jsonb, 2, $3)`,
      [projectId, otherProjectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into agent_tasks
        (id, research_task_id, project_id, request, created_by_type, created_by_id)
       values
        ('submission-agent-task', 'submission-agent-task-parent', $1, '{}'::jsonb, 'human', $3),
        ('submission-other-agent-task', 'submission-other-agent-task-parent', $2, '{}'::jsonb, 'human', $3)`,
      [projectId, otherProjectId, projectLeadId],
    );
    await testDb.client.sql.unsafe(
      `insert into agent_runs
        (id, agent_task_id, project_id, attempt_number, state, execution_policy,
         created_by_type, created_by_id)
       values
        ($1, 'submission-agent-task', $3, 1, '已提议', '{}'::jsonb, 'human', $5),
        ($2, 'submission-other-agent-task', $4, 1, '已提议', '{}'::jsonb, 'human', $5)`,
      [agentRunId, otherAgentRunId, projectId, otherProjectId, projectLeadId],
    );
  }

  async function createStartedTask(
    title: string,
    overrides: Partial<{
      description: string | null;
      executionMode: "human" | "agent" | "hybrid";
      reviewPolicy: "none" | "required";
      acceptanceCriteria: string[];
    }> = {},
  ) {
    const task = await createResearchTask(
      testDb.client.sql,
      projectId,
      {
        title,
        description: overrides.description ?? "Submission description",
        executionMode: overrides.executionMode ?? "human",
        reviewPolicy: overrides.reviewPolicy ?? "none",
        acceptanceCriteria: overrides.acceptanceCriteria ?? [],
      },
      { type: "human", id: ownerId },
    );
    return startResearchTask(
      testDb.client.sql,
      task.id,
      { type: "human", id: ownerId },
    );
  }

  it("requires a human accountable owner and an in-progress workflow-v2 task", async () => {
    const task = await createStartedTask("Owner only");

    await expect(
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "Agent cannot submit" },
        { type: "agent", id: "agent-run:test" },
      ),
    ).rejects.toThrow(/human/i);

    await expect(
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "Reviewer cannot submit" },
        { type: "human", id: reviewerId },
      ),
    ).rejects.toThrow(/owner|forbidden/i);

    const openTask = await createResearchTask(
      testDb.client.sql,
      projectId,
      { title: "Still open" },
      { type: "human", id: ownerId },
    );
    await expect(
      submitResearchTask(
        testDb.client.sql,
        openTask.id,
        { summary: "Too early" },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/in_progress|state/i);
  });

  it("stores bounded pure-text submissions with frozen requirement snapshots", async () => {
    const task = await createStartedTask("Snapshot v1", {
      description: "Old description",
      executionMode: "hybrid",
      acceptanceCriteria: ["Old criterion"],
    });

    await expect(
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "   " },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/summary|required/i);
    await expect(
      submitResearchTask(
        testDb.client.sql,
        task.id,
        { summary: "x".repeat(8_001) },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/summary|8000/i);

    const result = await submitResearchTask(
      testDb.client.sql,
      task.id,
      { summary: "  Formal delivery  " },
      { type: "human", id: ownerId },
    );
    expect(result.reviewRequestId).toBeNull();
    expect(result.submission).toMatchObject({
      researchTaskId: task.id,
      projectId,
      submissionNumber: 1,
      summary: "Formal delivery",
      submittedByMemberId: ownerId,
      requirementSnapshotSchemaVersion: 1,
      requirementSnapshot: {
        title: "Snapshot v1",
        description: "Old description",
        acceptanceCriteria: ["Old criterion"],
        executionMode: "hybrid",
        reviewPolicy: "none",
      },
    });

    const contributorRows = await testDb.client.sql.unsafe(
      `select contributor_kind, contributor_ref
       from task_submission_contributors
       where submission_id = $1`,
      [result.submission.id],
    );
    expect(contributorRows).toEqual([
      { contributor_kind: "human_member", contributor_ref: ownerId },
    ]);

    await updateResearchTaskRequirements(
      testDb.client.sql,
      task.id,
      {
        title: "Snapshot v2",
        description: "New description",
        acceptanceCriteria: ["New criterion"],
      },
      { type: "human", id: ownerId },
    );
    await setResearchTaskExecutionMode(
      testDb.client.sql,
      task.id,
      "human",
      { type: "human", id: ownerId },
    );

    const rows = await testDb.client.sql.unsafe(
      "select requirement_snapshot from task_submissions where id = $1",
      [result.submission.id],
    );
    expect(rows[0]?.requirement_snapshot).toEqual({
      title: "Snapshot v1",
      description: "Old description",
      acceptanceCriteria: ["Old criterion"],
      executionMode: "hybrid",
      reviewPolicy: "none",
    });
  });

  it("deduplicates contributor and typed-ref facts while preserving project provenance", async () => {
    const task = await createStartedTask("Dedupe provenance");
    const result = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: "Delivery with refs",
        contributors: [
          { kind: "human_member", memberId: ownerId },
          { kind: "human_member", memberId: contributorId },
          { kind: "human_member", memberId: contributorId },
          { kind: "agent_run", runId: agentRunId },
          { kind: "agent_run", runId: agentRunId },
        ],
        refs: [
          { kind: "file_version", refId: fileVersionId, relation: "deliverable" },
          { kind: "file_version", refId: fileVersionId, relation: "deliverable" },
          { kind: "research_result", refId: resultId, relation: "evidence" },
          { kind: "research_node_revision", refId: revisionId, relation: "source" },
          { kind: "agent_run", refId: agentRunId, relation: "context" },
        ],
      },
      { type: "human", id: ownerId },
    );

    const contributors = await testDb.client.sql.unsafe(
      `select contributor_kind, contributor_ref
       from task_submission_contributors
       where submission_id = $1
       order by contributor_kind, contributor_ref`,
      [result.submission.id],
    );
    expect(contributors).toEqual([
      { contributor_kind: "agent_run", contributor_ref: agentRunId },
      { contributor_kind: "human_member", contributor_ref: contributorId },
      { contributor_kind: "human_member", contributor_ref: ownerId },
    ]);

    const refs = await testDb.client.sql.unsafe(
      `select ref_kind, ref_id, relation
       from task_submission_refs
       where submission_id = $1
       order by ref_kind, ref_id, relation`,
      [result.submission.id],
    );
    expect(refs).toHaveLength(4);
  });

  it("fails closed for invalid contributors and cross-project stable refs without partial submission facts", async () => {
    const invalidContributorTask = await createStartedTask("Invalid contributor");
    await expect(
      submitResearchTask(
        testDb.client.sql,
        invalidContributorTask.id,
        {
          summary: "Invalid contributor",
          contributors: [{ kind: "human_member", memberId: outsiderId }],
        },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/contributor|access|project/i);

    const crossAgentContributorTask = await createStartedTask("Cross agent contributor");
    await expect(
      submitResearchTask(
        testDb.client.sql,
        crossAgentContributorTask.id,
        {
          summary: "Cross agent",
          contributors: [{ kind: "agent_run", runId: otherAgentRunId }],
        },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/agent|project/i);

    for (const [kind, refId] of [
      ["file_version", otherFileVersionId],
      ["research_result", otherResultId],
      ["research_node_revision", otherRevisionId],
      ["agent_run", otherAgentRunId],
    ] as const) {
      const task = await createStartedTask(`Cross ref ${kind}`);
      await expect(
        submitResearchTask(
          testDb.client.sql,
          task.id,
          {
            summary: "Cross-project ref",
            refs: [{ kind, refId, relation: "source" }],
          },
          { type: "human", id: ownerId },
        ),
      ).rejects.toThrow(/project|ref/i);

      const rows = await testDb.client.sql.unsafe(
        "select id from task_submissions where research_task_id = $1",
        [task.id],
      );
      expect(rows).toHaveLength(0);
    }
  });

  it("creates required ReviewRequest atomically and rejects ineligible or ambiguous reviewer inputs", async () => {
    const task = await createStartedTask("Required review", {
      reviewPolicy: "required",
    });
    const result = await submitResearchTask(
      testDb.client.sql,
      task.id,
      {
        summary: "Ready for review",
        contributors: [{ kind: "human_member", memberId: contributorId }],
        reviewerMemberId: reviewerId,
      },
      { type: "human", id: ownerId },
    );
    expect(result.reviewRequestId).toBeTruthy();

    const [taskRows, reviewRows, actionRows] = await Promise.all([
      testDb.client.sql.unsafe(
        "select status from research_tasks where id = $1",
        [task.id],
      ),
      testDb.client.sql.unsafe(
        "select reviewer_member_id, status from review_requests where id = $1",
        [result.reviewRequestId],
      ),
      testDb.client.sql.unsafe(
        `select action, actor_type, actor_id, new_reviewer_member_id, resulting_status
         from review_actions where review_request_id = $1`,
        [result.reviewRequestId],
      ),
    ]);
    expect(taskRows[0]?.status).toBe("awaiting_review");
    expect(reviewRows[0]).toMatchObject({
      reviewer_member_id: reviewerId,
      status: "pending",
    });
    expect(actionRows).toEqual([
      {
        action: "assigned",
        actor_type: "human",
        actor_id: ownerId,
        new_reviewer_member_id: reviewerId,
        resulting_status: "pending",
      },
    ]);

    for (const [label, reviewerMemberId, contributors] of [
      ["self reviewer", ownerId, []],
      ["contributor reviewer", contributorId, [{ kind: "human_member" as const, memberId: contributorId }]],
      ["outsider reviewer", outsiderId, []],
    ] as const) {
      const rejectedTask = await createStartedTask(label, { reviewPolicy: "required" });
      await expect(
        submitResearchTask(
          testDb.client.sql,
          rejectedTask.id,
          {
            summary: "Should reject reviewer",
            contributors: [...contributors],
            reviewerMemberId,
          },
          { type: "human", id: ownerId },
        ),
      ).rejects.toThrow(/reviewer|contributor|access|project/i);
    }

    const missingReviewerTask = await createStartedTask("Missing reviewer", {
      reviewPolicy: "required",
    });
    await expect(
      submitResearchTask(
        testDb.client.sql,
        missingReviewerTask.id,
        { summary: "No reviewer" },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/reviewer|required/i);

    const noneTask = await createStartedTask("No review policy");
    await expect(
      submitResearchTask(
        testDb.client.sql,
        noneTask.id,
        { summary: "Unexpected reviewer", reviewerMemberId: reviewerId },
        { type: "human", id: ownerId },
      ),
    ).rejects.toThrow(/reviewer|none|policy/i);
  });
});
