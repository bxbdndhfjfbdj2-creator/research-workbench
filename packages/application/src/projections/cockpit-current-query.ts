import type { AgentRunState } from "@research-workbench/domain/src/agent-runtime";
import { AGENT_RUN_STATES } from "@research-workbench/domain/src/agent-runtime";
import {
  RESEARCH_DIMENSIONS,
  RESEARCH_DIMENSION_STATES,
  type ResearchDimension,
  type ResearchDimensionStateValue,
} from "@research-workbench/domain/src/research-dimensions";
import {
  FILE_ACCESS_CLASSES,
  type FileAccessClass,
  type FileParseStatus,
} from "@research-workbench/domain/src/research-file";
import {
  RESEARCH_TASK_STATUSES,
  type ResearchTaskStatus,
} from "@research-workbench/domain/src/research-task";
import {
  DECISION_STATUSES,
  type DecisionStatus,
} from "@research-workbench/domain/src/scientific-decision";
import {
  REVIEW_REQUEST_STATUSES,
  type ReviewRequestStatus,
} from "@research-workbench/domain/src/task-review";
import { resolveScientificDecisionReviewStage } from "../decisions/review-eligibility";
import type { TransactionSql } from "../transactions";
import type {
  AgentRunCurrentFact,
  CockpitViewer,
  CurrentReviewFact,
  FileParseFailureCurrentFact,
  ProjectCurrentFacts,
  ResearchTaskCurrentFact,
  SafeProjectSummary,
  ScientificDecisionCurrentFact,
} from "./cockpit-types";

const FILE_PARSE_STATUSES = ["parsed", "failed", "not_applicable"] as const;

export class CockpitProjectionInconsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CockpitProjectionInconsistencyError";
  }
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function assertAllowed(
  value: string,
  allowed: readonly string[],
  label: string,
): void {
  if (!allowed.includes(value)) {
    throw new CockpitProjectionInconsistencyError(
      `Unsupported ${label} in cockpit projection: ${value}`,
    );
  }
}

export async function loadVisibleProjectIds(
  tx: TransactionSql,
  viewer: CockpitViewer,
): Promise<string[]> {
  const rows = await tx.unsafe(
    `select p.id
     from members viewer
     join research_portfolios rp on rp.team_id = viewer.team_id
     join research_projects p on p.portfolio_id = rp.id
     left join project_memberships pm
       on pm.project_id = p.id and pm.member_id = viewer.id
     where viewer.id = $1
       and viewer.team_id = $2
       and viewer.organization_role = $3
       and viewer.actor_type = 'human'
       and viewer.active = true
       and (viewer.organization_role = 'lead' or pm.id is not null)
     order by p.created_at asc, p.id asc`,
    [viewer.memberId, viewer.teamId, viewer.organizationRole],
  );

  return rows.map((row) => String(row.id));
}

async function loadProjects(
  tx: TransactionSql,
  projectIds: readonly string[],
): Promise<SafeProjectSummary[]> {
  if (projectIds.length === 0) return [];

  const projectRows = await tx.unsafe(
    `select p.id, p.title, p.lead_member_id, lead.display_name as lead_name
     from research_projects p
     join members lead on lead.id = p.lead_member_id
     where p.id = any($1::text[])
     order by p.created_at asc, p.id asc`,
    [projectIds],
  );
  const dimensionRows = await tx.unsafe(
    `select project_id, dimension, state
     from research_dimension_states
     where project_id = any($1::text[])
     order by project_id asc, dimension asc`,
    [projectIds],
  );

  const dimensions = new Map<
    string,
    Array<{ dimension: ResearchDimension; state: ResearchDimensionStateValue }>
  >();

  for (const row of dimensionRows) {
    const dimension = String(row.dimension);
    const state = String(row.state);
    assertAllowed(dimension, RESEARCH_DIMENSIONS, "research dimension");
    assertAllowed(state, RESEARCH_DIMENSION_STATES, "research dimension state");
    const projectId = String(row.project_id);
    const items = dimensions.get(projectId) ?? [];
    items.push({
      dimension: dimension as ResearchDimension,
      state: state as ResearchDimensionStateValue,
    });
    dimensions.set(projectId, items);
  }

  return projectRows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    leadMemberId: String(row.lead_member_id),
    leadName: String(row.lead_name),
    dimensions: dimensions.get(String(row.id)) ?? [],
  }));
}

async function loadTasks(
  tx: TransactionSql,
  projectIds: readonly string[],
): Promise<ResearchTaskCurrentFact[]> {
  if (projectIds.length === 0) return [];

  const rows = await tx.unsafe(
    `select
       t.id, t.project_id, p.title as project_title, t.title, t.status,
       t.assignee_member_id, owner.display_name as owner_name, t.updated_at,
       latest_submission.submission_number,
       latest_submission.created_at as latest_submission_at,
       rr.id as review_id, rr.status as review_status,
       rr.reviewer_member_id, rr.created_at as review_created_at,
       rr.updated_at as review_updated_at,
       linked_decision.scientific_decision_id,
       linked_decision.decision_updated_at,
       agent_activity.latest_agent_run_at
     from research_tasks t
     join research_projects p on p.id = t.project_id
     join members owner on owner.id = t.assignee_member_id
     left join lateral (
       select ts.id, ts.submission_number, ts.created_at
       from task_submissions ts
       where ts.research_task_id = t.id
       order by ts.submission_number desc, ts.id desc
       limit 1
     ) latest_submission on true
     left join review_requests rr
       on rr.task_submission_id = latest_submission.id
     left join lateral (
       select l.scientific_decision_id, d.updated_at as decision_updated_at
       from review_decision_links l
       join scientific_decisions d on d.id = l.scientific_decision_id
       where l.review_request_id = rr.id
       order by l.created_at desc, l.id desc
       limit 1
     ) linked_decision on true
     left join lateral (
       select max(ar.updated_at) as latest_agent_run_at
       from agent_tasks at
       join agent_runs ar on ar.agent_task_id = at.id
       where at.research_task_id = t.id
     ) agent_activity on true
     where t.project_id = any($1::text[])
     order by t.project_id asc, t.created_at asc, t.id asc`,
    [projectIds],
  );

  return rows.map((row) => {
    const status = String(row.status);
    assertAllowed(status, RESEARCH_TASK_STATUSES, "research task status");

    let currentReview: CurrentReviewFact | null = null;
    if (row.review_id) {
      const reviewStatus = String(row.review_status);
      assertAllowed(
        reviewStatus,
        REVIEW_REQUEST_STATUSES,
        "review request status",
      );
      currentReview = {
        id: String(row.review_id),
        status: reviewStatus as ReviewRequestStatus,
        reviewerMemberId: String(row.reviewer_member_id),
        submissionNumber: Number(row.submission_number ?? 0),
        createdAt: asDate(row.review_created_at),
        updatedAt: asDate(row.review_updated_at),
        linkedDecisionId: row.scientific_decision_id
          ? String(row.scientific_decision_id)
          : null,
      };
    }

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      projectTitle: String(row.project_title),
      title: String(row.title),
      status: status as ResearchTaskStatus,
      ownerMemberId: String(row.assignee_member_id),
      ownerDisplayName: String(row.owner_name),
      updatedAt: asDate(row.updated_at),
      latestSubmissionAt: row.latest_submission_at
        ? asDate(row.latest_submission_at)
        : null,
      latestReviewAt: row.review_updated_at ? asDate(row.review_updated_at) : null,
      latestLinkedDecisionAt: row.decision_updated_at
        ? asDate(row.decision_updated_at)
        : null,
      latestAgentRunAt: row.latest_agent_run_at
        ? asDate(row.latest_agent_run_at)
        : null,
      currentReview,
    };
  });
}

async function loadDecisions(
  tx: TransactionSql,
  viewer: CockpitViewer,
  projectIds: readonly string[],
): Promise<ScientificDecisionCurrentFact[]> {
  if (projectIds.length === 0) return [];

  const rows = await tx.unsafe(
    `select d.id, d.project_id, p.title as project_title, p.lead_member_id,
            d.title, d.status, d.updated_at
     from scientific_decisions d
     join research_projects p on p.id = d.project_id
     where d.project_id = any($1::text[])
     order by d.project_id asc, d.created_at asc, d.id asc`,
    [projectIds],
  );

  return rows.map((row) => {
    const status = String(row.status);
    assertAllowed(status, DECISION_STATUSES, "scientific decision status");
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      projectTitle: String(row.project_title),
      title: String(row.title),
      status: status as DecisionStatus,
      updatedAt: asDate(row.updated_at),
      reviewStage: resolveScientificDecisionReviewStage({
        status: status as DecisionStatus,
        projectLeadMemberId: String(row.lead_member_id),
        reviewerMemberId: viewer.memberId,
        reviewerOrganizationRole: viewer.organizationRole,
      }),
    };
  });
}

async function loadAgentRuns(
  tx: TransactionSql,
  projectIds: readonly string[],
): Promise<AgentRunCurrentFact[]> {
  if (projectIds.length === 0) return [];

  const rows = await tx.unsafe(
    `select ar.id, ar.agent_task_id, at.research_task_id, ar.project_id,
            p.title as project_title, t.title as task_title,
            ar.attempt_number, ar.state, ar.updated_at
     from agent_runs ar
     join agent_tasks at on at.id = ar.agent_task_id
     join research_tasks t on t.id = at.research_task_id
     join research_projects p on p.id = ar.project_id
     where ar.project_id = any($1::text[])
     order by ar.project_id asc, ar.agent_task_id asc, ar.attempt_number asc, ar.id asc`,
    [projectIds],
  );

  return rows.map((row) => {
    const state = String(row.state);
    assertAllowed(state, AGENT_RUN_STATES, "AgentRun state");
    return {
      id: String(row.id),
      agentTaskId: String(row.agent_task_id),
      researchTaskId: String(row.research_task_id),
      projectId: String(row.project_id),
      projectTitle: String(row.project_title),
      taskTitle: String(row.task_title),
      attemptNumber: Number(row.attempt_number),
      state: state as AgentRunState,
      updatedAt: asDate(row.updated_at),
    };
  });
}

async function loadFileParseFailures(
  tx: TransactionSql,
  projectIds: readonly string[],
): Promise<FileParseFailureCurrentFact[]> {
  if (projectIds.length === 0) return [];

  const rows = await tx.unsafe(
    `select rf.id as research_file_id, rf.project_id, p.title as project_title,
            rf.title as file_title, rf.access_class,
            fv.id as file_version_id, fv.version_number, fv.parse_status,
            coalesce(parse_failure.finished_at, parse_failure.created_at, fv.created_at)
              as failed_at
     from research_files rf
     join research_projects p on p.id = rf.project_id
     join file_versions fv on fv.id = rf.current_version_id
     left join lateral (
       select fpr.finished_at, fpr.created_at
       from file_processing_records fpr
       where fpr.file_version_id = fv.id
         and fpr.status = 'failed'
       order by coalesce(fpr.finished_at, fpr.created_at) desc, fpr.id desc
       limit 1
     ) parse_failure on true
     where rf.project_id = any($1::text[])
     order by rf.project_id asc, rf.created_at asc, rf.id asc`,
    [projectIds],
  );

  const failures: FileParseFailureCurrentFact[] = [];
  for (const row of rows) {
    const accessClass = String(row.access_class);
    const parseStatus = String(row.parse_status);
    assertAllowed(accessClass, FILE_ACCESS_CLASSES, "file access class");
    assertAllowed(parseStatus, FILE_PARSE_STATUSES, "FileVersion parse status");

    if (parseStatus !== "failed") continue;

    failures.push({
      researchFileId: String(row.research_file_id),
      fileVersionId: String(row.file_version_id),
      projectId: String(row.project_id),
      projectTitle: String(row.project_title),
      fileTitle: String(row.file_title),
      versionNumber: Number(row.version_number),
      accessClass: accessClass as FileAccessClass,
      parseStatus: parseStatus as FileParseStatus,
      failedAt: asDate(row.failed_at),
    });
  }
  return failures;
}

export async function loadCurrentProjectFacts(
  tx: TransactionSql,
  viewer: CockpitViewer,
  projectIds: readonly string[],
): Promise<ProjectCurrentFacts[]> {
  if (projectIds.length === 0) return [];

  const visibleIds = new Set(await loadVisibleProjectIds(tx, viewer));
  const authorizedProjectIds = projectIds.filter((id) => visibleIds.has(id));
  if (authorizedProjectIds.length === 0) return [];

  const [projects, tasks, decisions, agentRuns, fileParseFailures] =
    await Promise.all([
      loadProjects(tx, authorizedProjectIds),
      loadTasks(tx, authorizedProjectIds),
      loadDecisions(tx, viewer, authorizedProjectIds),
      loadAgentRuns(tx, authorizedProjectIds),
      loadFileParseFailures(tx, authorizedProjectIds),
    ]);

  return projects.map((project) => ({
    project,
    tasks: tasks.filter((item) => item.projectId === project.id),
    decisions: decisions.filter((item) => item.projectId === project.id),
    agentRuns: agentRuns.filter((item) => item.projectId === project.id),
    fileParseFailures: fileParseFailures.filter(
      (item) => item.projectId === project.id,
    ),
  }));
}
