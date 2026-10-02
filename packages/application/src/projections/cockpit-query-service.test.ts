import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";
import { runInReadOnlySnapshot } from "../transactions";
import type { CockpitViewer } from "./cockpit-types";
import {
  CockpitProjectionInconsistencyError,
  loadCurrentProjectFacts,
  loadVisibleProjectIds,
} from "./cockpit-current-query";
import { loadRecentCockpitActivity } from "./cockpit-activity-query";
import {
  getProjectCockpit,
  listPortfolioCockpit,
} from "./cockpit-query-service";

const TEAM_A = "cockpit-team-a";
const TEAM_B = "cockpit-team-b";
const VIEWER = "cockpit-researcher-a";
const OTHER_REVIEWER = "cockpit-researcher-b";
const LEAD_A = "cockpit-org-lead-a";
const LEAD_B = "cockpit-org-lead-b";
const PROJECT_A = "cockpit-project-a";
const PROJECT_A_OTHER = "cockpit-project-b";
const PROJECT_B = "cockpit-project-z";

const LOCATOR_SENTINEL = "SENSITIVE_RESTRICTED_LOCATOR";
const POLICY_SENTINEL = "SENSITIVE_ACCESS_POLICY";
const SUBMISSION_SENTINEL = "SENSITIVE_SUBMISSION_SUMMARY";
const DECISION_SENTINEL = "SENSITIVE_DECISION_REASON";
const AGENT_SENTINEL = "SENSITIVE_AGENT_REQUEST";
const SOURCE_SENTINEL = "SENSITIVE_SOURCE_METADATA";
const ACTIVITY_SENTINEL = "SENSITIVE_ACTIVITY_PAYLOAD";
const NOW = new Date("2026-10-01T12:00:00.000Z");

const researcherViewer: CockpitViewer = {
  memberId: VIEWER,
  teamId: TEAM_A,
  organizationRole: "researcher",
};

const leadViewer: CockpitViewer = {
  memberId: LEAD_A,
  teamId: TEAM_A,
  organizationRole: "lead",
};

describe("cockpit current-state queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      `insert into teams (id, name)
       values ($1, 'Cockpit Team A'), ($2, 'Cockpit Team B')`,
      [TEAM_A, TEAM_B],
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values
        ($1, $5, 'viewer@cockpit.test', '研究员 A', 'researcher', 'human'),
        ($2, $5, 'other@cockpit.test', '研究员 B', 'researcher', 'human'),
        ($3, $5, 'lead-a@cockpit.test', '总负责人 A', 'lead', 'human'),
        ($4, $6, 'lead-b@cockpit.test', '总负责人 B', 'lead', 'human')`,
      [VIEWER, OTHER_REVIEWER, LEAD_A, LEAD_B, TEAM_A, TEAM_B],
    );
    await testDb.client.sql.unsafe(
      `insert into research_portfolios (id, team_id, name)
       values
        ('cockpit-portfolio-a', $1, 'Portfolio A'),
        ('cockpit-portfolio-b', $2, 'Portfolio B')`,
      [TEAM_A, TEAM_B],
    );
    await testDb.client.sql.unsafe(
      `insert into research_projects (id, portfolio_id, title, lead_member_id)
       values
        ($1, 'cockpit-portfolio-a', '研究 A', $4),
        ($2, 'cockpit-portfolio-a', '研究 B', $5),
        ($3, 'cockpit-portfolio-b', '研究 Z', $6)`,
      [PROJECT_A, PROJECT_A_OTHER, PROJECT_B, VIEWER, OTHER_REVIEWER, LEAD_B],
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values
        ('cockpit-membership-viewer', $1, $2, 'lead'),
        ('cockpit-membership-other', $1, $3, 'collaborator')`,
      [PROJECT_A, VIEWER, OTHER_REVIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into research_dimension_states
        (id, project_id, dimension, state, updated_by)
       values ('cockpit-dimension', $1, '数据', '验证中', $2)`,
      [PROJECT_A, VIEWER],
    );

    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, execution_mode,
         review_policy, acceptance_criteria, workflow_version, created_by)
       values
        ('task-blocked', $1, '受阻任务', 'blocked', $2, 'human', 'none', '[]'::jsonb, 2, $2),
        ('task-review-me', $1, '待我审核', 'awaiting_review', $3, 'human', 'required', '[]'::jsonb, 2, $3),
        ('task-review-other', $1, '待他人审核', 'awaiting_review', $2, 'human', 'required', '[]'::jsonb, 2, $2),
        ('task-await-decision', $1, '等待科学决策', 'awaiting_review', $3, 'human', 'required', '[]'::jsonb, 2, $3),
        ('task-agent', $1, 'Agent 任务', 'in_progress', $2, 'agent', 'none', '[]'::jsonb, 2, $2),
        ('task-history', $1, '历史受阻但当前执行中', 'in_progress', $2, 'human', 'none', '[]'::jsonb, 2, $2),
        ('task-blocked-2', $1, '受阻任务二', 'blocked', $2, 'human', 'none', '[]'::jsonb, 2, $2),
        ('task-blocked-3', $1, '受阻任务三', 'blocked', $2, 'human', 'none', '[]'::jsonb, 2, $2),
        ('task-blocked-4', $1, '受阻任务四', 'blocked', $2, 'human', 'none', '[]'::jsonb, 2, $2)`,
      [PROJECT_A, VIEWER, OTHER_REVIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into task_submissions
        (id, research_task_id, project_id, submission_number, summary,
         requirement_snapshot, requirement_snapshot_schema_version, submitted_by_member_id)
       values
        ('submission-me', 'task-review-me', $1, 1, $3, '{}'::jsonb, 1, $2),
        ('submission-other', 'task-review-other', $1, 1, 'other summary', '{}'::jsonb, 1, $2),
        ('submission-decision', 'task-await-decision', $1, 1, 'decision summary', '{}'::jsonb, 1, $2)`,
      [PROJECT_A, VIEWER, SUBMISSION_SENTINEL],
    );
    await testDb.client.sql.unsafe(
      `insert into review_requests
        (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
       values
        ('review-me', $1, 'submission-me', $2, 'pending', $3),
        ('review-other', $1, 'submission-other', $3, 'pending', $2),
        ('review-decision', $1, 'submission-decision', $3, 'awaiting_scientific_decision', $2)`,
      [PROJECT_A, VIEWER, OTHER_REVIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into scientific_decisions
        (id, project_id, level, title, reason, evidence, impact, change_kind,
         status, proposed_by_type, proposed_by_id)
       values
        ('decision-linked', $1, 'major', '升级正式理论', $3,
         '[{"kind":"result","ref":"SENSITIVE_EVIDENCE"}]'::jsonb,
         '["SENSITIVE_IMPACT"]'::jsonb, 'record_only', 'proposed', 'human', $2),
        ('decision-team', $1, 'major', '团队级决策', 'team reason',
         '[]'::jsonb, '[]'::jsonb, 'record_only', 'awaiting_lead', 'human', $2)`,
      [PROJECT_A, VIEWER, DECISION_SENTINEL],
    );
    await testDb.client.sql.unsafe(
      `insert into review_decision_links
        (id, review_request_id, scientific_decision_id, created_by_member_id)
       values ('review-decision-link', 'review-decision', 'decision-linked', $1)`,
      [OTHER_REVIEWER],
    );

    await testDb.client.sql.unsafe(
      `insert into agent_tasks
        (id, research_task_id, project_id, request, created_by_type, created_by_id)
       values
        ('agent-task-current', 'task-agent', $1, $2::jsonb, 'human', $3)`,
      [PROJECT_A, JSON.stringify({ objective: AGENT_SENTINEL }), VIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into agent_context_snapshots
        (id, project_id, asset_version_refs, skill_version_refs,
         harness_version, harness_profile, runtime_profile, model_route,
         sandbox_policy, tool_allowlist, subagent_allowlist,
         created_by_type, created_by_id)
       values
        ('agent-context-fixture', $1, '[]'::jsonb, '[]'::jsonb,
         'fixture-harness', 'fixture-profile', 'fixture-runtime', 'fixture-model',
         'read-only', '[]'::jsonb, '[]'::jsonb, 'human', $2)`,
      [PROJECT_A, VIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into agent_runs
        (id, agent_task_id, project_id, attempt_number, context_snapshot_id,
         state, execution_policy, created_by_type, created_by_id)
       values
        ('agent-run-1', 'agent-task-current', $1, 1, 'agent-context-fixture',
         '失败', '{}'::jsonb, 'human', $2),
        ('agent-run-2', 'agent-task-current', $1, 2, 'agent-context-fixture',
         '完成', '{}'::jsonb, 'human', $2)`,
      [PROJECT_A, VIEWER],
    );

    await testDb.client.sql.unsafe(
      `insert into external_data_references
        (id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
         version_label, created_by)
       values
        ('external-sensitive', $1, $2, 'manifest-sensitive', $3, 'v1', $4)`,
      [PROJECT_A, LOCATOR_SENTINEL, POLICY_SENTINEL, VIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into file_blobs
        (id, sha256, storage_backend, storage_key, byte_size,
         media_type_detected, quarantine_state)
       values
        ('blob-current', repeat('a', 64), 'fixture', 'cockpit/current', 10,
         'application/pdf', 'clean'),
        ('blob-old-v1', repeat('b', 64), 'fixture', 'cockpit/old-v1', 11,
         'application/pdf', 'clean'),
        ('blob-old-v2', repeat('c', 64), 'fixture', 'cockpit/old-v2', 12,
         'application/pdf', 'clean')`,
    );
    await testDb.client.sql.unsafe(
      `insert into research_files
        (id, project_id, title, file_kind, access_class, lifecycle_state, created_by)
       values
        ('file-current-fail', $1, '受限当前失败文件', 'dataset', 'restricted', 'active', $2),
        ('file-old-fail', $1, '旧失败已被新版本替代', 'dataset', 'project', 'active', $2),
        ('file-external-sensitive', $1, '受限外部引用', 'dataset', 'restricted', 'active', $2)`,
      [PROJECT_A, VIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, blob_id, original_filename,
         media_type, byte_size, sha256, source_kind, source_metadata,
         scan_status, parse_status, created_by)
       values
        ('file-current-v1', 'file-current-fail', 1, 'blob-current', 'restricted-v1.pdf',
         'application/pdf', 10, repeat('a', 64), 'upload', $1::jsonb,
         'passed', 'failed', $2),
        ('file-old-v1', 'file-old-fail', 1, 'blob-old-v1', 'old-v1.pdf',
         'application/pdf', 11, repeat('b', 64), 'upload', '{}'::jsonb,
         'passed', 'failed', $2),
        ('file-old-v2', 'file-old-fail', 2, 'blob-old-v2', 'old-v2.pdf',
         'application/pdf', 12, repeat('c', 64), 'upload', '{}'::jsonb,
         'passed', 'parsed', $2)`,
      [JSON.stringify({ note: SOURCE_SENTINEL }), VIEWER],
    );
    await testDb.client.sql.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, external_reference_id, original_filename,
         source_kind, source_metadata, scan_status, parse_status, created_by)
       values
        ('file-external-v1', 'file-external-sensitive', 1, 'external-sensitive', 'external-v1',
         'external_reference', '{}'::jsonb, 'not_applicable', 'not_applicable', $1)`,
      [VIEWER],
    );
    await testDb.client.sql.unsafe(
      `update research_files
       set current_version_id = case
         when id = 'file-current-fail' then 'file-current-v1'
         when id = 'file-old-fail' then 'file-old-v2'
         when id = 'file-external-sensitive' then 'file-external-v1'
       end
       where id in ('file-current-fail', 'file-old-fail', 'file-external-sensitive')`,
    );
    await testDb.client.sql.unsafe(
      `insert into file_processing_records
        (id, file_version_id, processor_kind, processor_name, processor_version,
         status, input_hash, output_refs, error_code, finished_at)
       values
        ('parse-failure-current', 'file-current-v1', 'parser', 'fixture-parser', '1',
         'failed', repeat('d', 64), '[]'::jsonb, 'parse_failed', now())`,
    );

    await testDb.client.sql.unsafe(
      `insert into research_events
        (id, project_id, event_type, actor_type, actor_id, payload, created_at)
       values
        ('activity-state', $1, 'RESEARCH_STATE_CHANGED', 'human', $2,
         $3::jsonb, '2026-10-01T11:30:00Z'),
        ('activity-result', $1, 'RESEARCH_RESULT_CREATED', 'human', $2,
         '{"resultId":"result-safe"}'::jsonb, '2026-10-01T11:20:00Z'),
        ('activity-agent-failed', $1, 'AGENT_RUN_FAILED', 'system', 'fixture-agent',
         '{"agentRunId":"agent-run-1"}'::jsonb, '2026-10-01T11:10:00Z'),
        ('activity-file-parse', $1, 'FILE_PARSE_FAILED', 'system', 'fixture-parser',
         '{"fileVersionId":"file-old-v1","sha256":"RAW_SHA_MUST_NOT_LEAK","errorCode":"RICH_PARSE_FAILED"}'::jsonb,
         '2026-10-01T11:00:00Z'),
        ('activity-task-blocked', $1, 'RESEARCH_TASK_BLOCKED', 'human', $2,
         '{"researchTaskId":"task-history"}'::jsonb, '2026-10-01T10:50:00Z'),
        ('activity-review', $1, 'REVIEW_REASSIGNED', 'human', $2,
         '{"reviewRequestId":"review-other","reviewerMemberId":"cockpit-researcher-b"}'::jsonb,
         '2026-10-01T10:40:00Z'),
        ('activity-decision', $1, 'SCIENTIFIC_DECISION_CREATED', 'human', $2,
         '{"decisionId":"decision-team"}'::jsonb, '2026-10-01T10:30:00Z'),
        ('activity-file-created', $1, 'RESEARCH_FILE_CREATED', 'human', $2,
         '{"researchFileId":"file-current-fail"}'::jsonb, '2026-10-01T10:20:00Z'),
        ('activity-version-created', $1, 'FILE_VERSION_CREATED', 'human', $2,
         '{"researchFileId":"file-current-fail","fileVersionId":"file-current-v1","versionNumber":1}'::jsonb,
         '2026-10-01T10:10:00Z'),
        ('activity-submission', $1, 'TASK_SUBMISSION_CREATED', 'human', $2,
         '{"researchTaskId":"task-review-me","taskSubmissionId":"submission-me","submissionNumber":1}'::jsonb,
         '2026-10-01T10:00:00Z'),
        ('activity-extra-1', $1, 'RESEARCH_TASK_UNBLOCKED', 'human', $2,
         '{"researchTaskId":"task-history"}'::jsonb, '2026-10-01T09:50:00Z'),
        ('activity-extra-2', $1, 'RESEARCH_TASK_REOPENED', 'human', $2,
         '{"researchTaskId":"task-history"}'::jsonb, '2026-10-01T09:40:00Z'),
        ('activity-old', $1, 'RESEARCH_TASK_BLOCKED', 'human', $2,
         '{"researchTaskId":"task-history"}'::jsonb, '2026-09-01T00:00:00Z'),
        ('activity-unknown', $1, 'COCKPIT_UNKNOWN_EVENT', 'human', $2,
         '{"researchTaskId":"task-history"}'::jsonb, '2026-10-01T11:45:00Z')`,
      [
        PROJECT_A,
        VIEWER,
        JSON.stringify({
          dimension: "数据",
          state: "验证中",
          extra: ACTIVITY_SENTINEL,
        }),
      ],
    );

  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("limits visible projects by team and membership", async () => {
    const leadProjects = await runInReadOnlySnapshot(testDb.client.sql, (tx) =>
      loadVisibleProjectIds(tx, leadViewer),
    );
    const researcherProjects = await runInReadOnlySnapshot(
      testDb.client.sql,
      (tx) => loadVisibleProjectIds(tx, researcherViewer),
    );

    expect(leadProjects).toEqual([PROJECT_A, PROJECT_A_OTHER]);
    expect(researcherProjects).toEqual([PROJECT_A]);
    expect(leadProjects).not.toContain(PROJECT_B);
    expect(researcherProjects).not.toContain(PROJECT_B);
  });

  it("loads only safe current facts and current file versions", async () => {
    const projects = await runInReadOnlySnapshot(testDb.client.sql, (tx) =>
      loadCurrentProjectFacts(tx, researcherViewer, [PROJECT_A]),
    );

    expect(projects).toHaveLength(1);
    const project = projects[0]!;
    expect(project.project.title).toBe("研究 A");
    expect(project.tasks.some((item) => item.id === "task-blocked")).toBe(true);
    expect(project.tasks.find((item) => item.id === "task-review-me")?.currentReview)
      .toMatchObject({
        id: "review-me",
        reviewerMemberId: VIEWER,
        status: "pending",
        submissionNumber: 1,
      });
    expect(project.tasks.find((item) => item.id === "task-review-other")?.currentReview)
      .toMatchObject({ id: "review-other", reviewerMemberId: OTHER_REVIEWER });
    expect(project.agentRuns.map((item) => item.attemptNumber)).toEqual([1, 2]);
    expect(project.fileParseFailures).toHaveLength(1);
    expect(project.fileParseFailures[0]).toMatchObject({
      researchFileId: "file-current-fail",
      fileVersionId: "file-current-v1",
      accessClass: "restricted",
      parseStatus: "failed",
    });
    expect(
      project.fileParseFailures.some((item) => item.fileVersionId === "file-old-v1"),
    ).toBe(false);

    const serialized = JSON.stringify(projects);
    for (const sentinel of [
      LOCATOR_SENTINEL,
      POLICY_SENTINEL,
      SUBMISSION_SENTINEL,
      DECISION_SENTINEL,
      AGENT_SENTINEL,
      SOURCE_SENTINEL,
      "SENSITIVE_EVIDENCE",
      "SENSITIVE_IMPACT",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("derives ScientificDecision responsibility from the shared eligibility rule", async () => {
    const researcherFacts = await runInReadOnlySnapshot(testDb.client.sql, (tx) =>
      loadCurrentProjectFacts(tx, researcherViewer, [PROJECT_A]),
    );
    const leadFacts = await runInReadOnlySnapshot(testDb.client.sql, (tx) =>
      loadCurrentProjectFacts(tx, leadViewer, [PROJECT_A]),
    );

    const researcherDecisions = researcherFacts[0]!.decisions;
    expect(
      researcherDecisions.find((item) => item.id === "decision-linked")?.reviewStage,
    ).toBe("project_lead");
    expect(
      researcherDecisions.find((item) => item.id === "decision-team")?.reviewStage,
    ).toBeNull();

    const leadDecisions = leadFacts[0]!.decisions;
    expect(
      leadDecisions.find((item) => item.id === "decision-linked")?.reviewStage,
    ).toBeNull();
    expect(
      leadDecisions.find((item) => item.id === "decision-team")?.reviewStage,
    ).toBe("team_lead");
  });

  it("fails closed on an unknown projection-critical canonical state", async () => {
    await testDb.client.sql.unsafe(
      "update research_dimension_states set state = 'projection_test_unknown' where id = 'cockpit-dimension'",
    );

    try {
      await expect(
        runInReadOnlySnapshot(testDb.client.sql, (tx) =>
          loadCurrentProjectFacts(tx, researcherViewer, [PROJECT_A]),
        ),
      ).rejects.toBeInstanceOf(CockpitProjectionInconsistencyError);
    } finally {
      await testDb.client.sql.unsafe(
        "update research_dimension_states set state = '验证中' where id = 'cockpit-dimension'",
      );
    }
  });

  it("loads only curated recent activity within the 14-day window", async () => {
    const activity = await runInReadOnlySnapshot(testDb.client.sql, (tx) =>
      loadRecentCockpitActivity(tx, [PROJECT_A], NOW),
    );

    expect(activity).toHaveLength(10);
    expect(activity.map((item) => item.id)).not.toContain("activity-old");
    expect(activity.map((item) => item.id)).not.toContain("activity-unknown");
    expect(activity.map((item) => item.kind)).toContain("research_state_changed");
    expect(activity.map((item) => item.kind)).toContain("research_result_created");
    expect(activity.map((item) => item.kind)).toContain("agent_run_changed");
    expect(activity.map((item) => item.kind)).toContain("file_parse_failed");
    expect(activity[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(
      activity.at(-1)?.occurredAt.getTime() ?? 0,
    );

    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain(ACTIVITY_SENTINEL);
    expect(serialized).not.toContain("RAW_SHA_MUST_NOT_LEAK");
    expect(serialized).not.toContain("RICH_PARSE_FAILED");
  });

  it("keeps historical events separate from current attention", async () => {
    const project = await getProjectCockpit(
      testDb.client.sql,
      researcherViewer,
      PROJECT_A,
      NOW,
    );

    expect(
      project.attention.some(
        (item) =>
          item.kind === "blocked_task" &&
          "taskId" in item &&
          item.taskId === "task-history",
      ),
    ).toBe(false);
    expect(
      project.attention.some(
        (item) =>
          item.kind === "agent_run_failed" &&
          "agentTaskId" in item &&
          item.agentTaskId === "agent-task-current",
      ),
    ).toBe(false);
    expect(
      project.attention.some(
        (item) =>
          item.kind === "file_parse_failed" &&
          "researchFileId" in item &&
          item.researchFileId === "file-old-fail",
      ),
    ).toBe(false);

    expect(project.recentActivity.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "activity-task-blocked",
        "activity-agent-failed",
        "activity-file-parse",
      ]),
    );
  });

  it("assembles role-aware portfolio and full project projections", async () => {
    const portfolio = await listPortfolioCockpit(
      testDb.client.sql,
      researcherViewer,
      NOW,
    );
    const project = await getProjectCockpit(
      testDb.client.sql,
      researcherViewer,
      PROJECT_A,
      NOW,
    );

    expect(portfolio.generatedAt).toEqual(NOW);
    expect(project.generatedAt).toEqual(NOW);
    expect(portfolio.projects).toHaveLength(1);
    expect(portfolio.projects[0]?.project.id).toBe(PROJECT_A);

    const blockedLane = portfolio.projects[0]?.lanes.find(
      (lane) => lane.kind === "blocked_task",
    );
    expect(blockedLane?.totalCount).toBe(4);
    expect(blockedLane?.preview).toHaveLength(3);

    expect(portfolio.myActions.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["my_review", "my_scientific_decision"]),
    );
    expect(project.explicitActions.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["my_review", "my_scientific_decision"]),
    );
    expect(
      project.attention.filter((item) => item.kind === "blocked_task"),
    ).toHaveLength(4);

    const serialized = JSON.stringify({ portfolio, project });
    expect(serialized).not.toMatch(
      /progressPercent|healthScore|riskScore|priorityScore/i,
    );
  });

  it("does not write ResearchEvent or Outbox state while projecting", async () => {
    const beforeEvents = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events",
    );
    const beforeOutbox = await testDb.client.sql.unsafe(
      "select count(*)::int as count from outbox_events",
    );

    await listPortfolioCockpit(testDb.client.sql, researcherViewer, NOW);
    await getProjectCockpit(testDb.client.sql, researcherViewer, PROJECT_A, NOW);

    const afterEvents = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events",
    );
    const afterOutbox = await testDb.client.sql.unsafe(
      "select count(*)::int as count from outbox_events",
    );

    expect(afterEvents[0]?.count).toBe(beforeEvents[0]?.count);
    expect(afterOutbox[0]?.count).toBe(beforeOutbox[0]?.count);
  });

});
