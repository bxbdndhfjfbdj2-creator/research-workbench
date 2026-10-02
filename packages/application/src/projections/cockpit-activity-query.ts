import {
  RESEARCH_DIMENSIONS,
  RESEARCH_DIMENSION_STATES,
} from "@research-workbench/domain/src/research-dimensions";
import type { TransactionSql } from "../transactions";
import {
  COCKPIT_RECENT_MS,
  sortActivityItems,
} from "./cockpit-classification";
import type {
  CockpitActivityItem,
  CockpitActivityKind,
} from "./cockpit-types";

export const COCKPIT_ACTIVITY_EVENT_TYPES = [
  "TASK_SUBMISSION_CREATED",
  "RESEARCH_TASK_COMPLETED",
  "RESEARCH_TASK_REOPENED",
  "RESEARCH_TASK_BLOCKED",
  "RESEARCH_TASK_UNBLOCKED",
  "REVIEW_APPROVED",
  "REVIEW_CHANGES_REQUESTED",
  "REVIEW_REJECTED",
  "REVIEW_REASSIGNED",
  "REVIEW_ESCALATED",
  "REVIEW_SCIENTIFIC_DECISION_RESOLVED",
  "SCIENTIFIC_DECISION_CREATED",
  "SCIENTIFIC_DECISION_EVIDENCE_REQUESTED",
  "SCIENTIFIC_DECISION_PROJECT_LEAD_APPROVED",
  "SCIENTIFIC_DECISION_APPROVED",
  "SCIENTIFIC_DECISION_REJECTED",
  "RESEARCH_STATE_CHANGED",
  "RESEARCH_RESULT_CREATED",
  "RESEARCH_RESULT_SUPERSEDED",
  "AGENT_RUN_WAITING_HUMAN",
  "AGENT_RUN_COMPLETED",
  "AGENT_RUN_FAILED",
  "RESEARCH_FILE_CREATED",
  "FILE_VERSION_CREATED",
  "FILE_PARSE_FAILED",
  "FILE_SCAN_REJECTED",
] as const;

type ActivityEventType = (typeof COCKPIT_ACTIVITY_EVENT_TYPES)[number];

type ActivityRow = {
  id: unknown;
  project_id: unknown;
  project_title: unknown;
  event_type: unknown;
  created_at: unknown;
  research_task_id: unknown;
  task_submission_id: unknown;
  review_request_id: unknown;
  decision_id: unknown;
  result_id: unknown;
  old_result_id: unknown;
  agent_run_id: unknown;
  research_file_id: unknown;
  file_version_id: unknown;
  dimension: unknown;
  dimension_state: unknown;
  task_title: unknown;
  submission_number: unknown;
  decision_title: unknown;
  result_title: unknown;
  agent_attempt_number: unknown;
  file_title: unknown;
  file_version_number: unknown;
};

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function taskHref(projectId: string, taskId: string | null): string {
  return taskId
    ? `/projects/${projectId}/work/${taskId}`
    : `/projects/${projectId}/work`;
}

function fileHref(projectId: string, researchFileId: string | null): string {
  return researchFileId
    ? `/projects/${projectId}/files/${researchFileId}`
    : `/projects/${projectId}/files`;
}

function activityKind(eventType: ActivityEventType): CockpitActivityKind {
  if (eventType === "TASK_SUBMISSION_CREATED") return "task_submission_created";
  if (eventType.startsWith("RESEARCH_TASK_")) return "task_status_changed";
  if (eventType.startsWith("REVIEW_")) return "review_changed";
  if (eventType.startsWith("SCIENTIFIC_DECISION_")) {
    return "scientific_decision_changed";
  }
  if (eventType === "RESEARCH_STATE_CHANGED") return "research_state_changed";
  if (eventType === "RESEARCH_RESULT_CREATED") return "research_result_created";
  if (eventType === "RESEARCH_RESULT_SUPERSEDED") {
    return "research_result_superseded";
  }
  if (eventType.startsWith("AGENT_RUN_")) return "agent_run_changed";
  if (eventType === "RESEARCH_FILE_CREATED") return "research_file_created";
  if (eventType === "FILE_VERSION_CREATED") return "file_version_created";
  if (eventType === "FILE_PARSE_FAILED") return "file_parse_failed";
  return "file_scan_rejected";
}

function labelFor(row: ActivityRow, eventType: ActivityEventType): string {
  const taskTitle = textOrNull(row.task_title) ?? "科研事项";
  const decisionTitle = textOrNull(row.decision_title) ?? "科学决策";
  const resultTitle = textOrNull(row.result_title) ?? "科研结果";
  const fileTitle = textOrNull(row.file_title) ?? "研究文件";
  const submissionNumber = numberOrNull(row.submission_number);
  const attemptNumber = numberOrNull(row.agent_attempt_number);
  const versionNumber = numberOrNull(row.file_version_number);

  switch (eventType) {
    case "TASK_SUBMISSION_CREATED":
      return submissionNumber
        ? `${taskTitle} · 提交 #${submissionNumber}`
        : `${taskTitle} · 新提交`;
    case "RESEARCH_TASK_COMPLETED":
      return `${taskTitle} · 已完成`;
    case "RESEARCH_TASK_REOPENED":
      return `${taskTitle} · 已重新开启`;
    case "RESEARCH_TASK_BLOCKED":
      return `${taskTitle} · 已受阻`;
    case "RESEARCH_TASK_UNBLOCKED":
      return `${taskTitle} · 已解除受阻`;
    case "REVIEW_APPROVED":
      return `${taskTitle} · 审核已批准`;
    case "REVIEW_CHANGES_REQUESTED":
      return `${taskTitle} · 审核要求修改`;
    case "REVIEW_REJECTED":
      return `${taskTitle} · 审核已拒绝`;
    case "REVIEW_REASSIGNED":
      return `${taskTitle} · 审核人已变更`;
    case "REVIEW_ESCALATED":
      return `${taskTitle} · 已升级为科学决策`;
    case "REVIEW_SCIENTIFIC_DECISION_RESOLVED":
      return `${taskTitle} · 科学决策已返回审核流程`;
    case "SCIENTIFIC_DECISION_CREATED":
      return `${decisionTitle} · 已提出`;
    case "SCIENTIFIC_DECISION_EVIDENCE_REQUESTED":
      return `${decisionTitle} · 要求补充证据`;
    case "SCIENTIFIC_DECISION_PROJECT_LEAD_APPROVED":
      return `${decisionTitle} · 项目负责人已批准`;
    case "SCIENTIFIC_DECISION_APPROVED":
      return `${decisionTitle} · 已批准`;
    case "SCIENTIFIC_DECISION_REJECTED":
      return `${decisionTitle} · 已拒绝`;
    case "RESEARCH_STATE_CHANGED": {
      const dimension = textOrNull(row.dimension);
      const state = textOrNull(row.dimension_state);
      const validDimension =
        dimension &&
        (RESEARCH_DIMENSIONS as readonly string[]).includes(dimension);
      const validState =
        state &&
        (RESEARCH_DIMENSION_STATES as readonly string[]).includes(state);
      return validDimension && validState
        ? `${dimension} · ${state}`
        : "科研状态已变更";
    }
    case "RESEARCH_RESULT_CREATED":
      return `${resultTitle} · 已创建`;
    case "RESEARCH_RESULT_SUPERSEDED":
      return `${resultTitle} · 已替代旧结果`;
    case "AGENT_RUN_WAITING_HUMAN":
      return attemptNumber
        ? `${taskTitle} · Agent 尝试 #${attemptNumber} 等待人工输入`
        : `${taskTitle} · Agent 等待人工输入`;
    case "AGENT_RUN_COMPLETED":
      return attemptNumber
        ? `${taskTitle} · Agent 尝试 #${attemptNumber} 完成`
        : `${taskTitle} · Agent 运行完成`;
    case "AGENT_RUN_FAILED":
      return attemptNumber
        ? `${taskTitle} · Agent 尝试 #${attemptNumber} 失败`
        : `${taskTitle} · Agent 运行失败`;
    case "RESEARCH_FILE_CREATED":
      return `${fileTitle} · 已创建`;
    case "FILE_VERSION_CREATED":
      return versionNumber
        ? `${fileTitle} · 版本 #${versionNumber} 已创建`
        : `${fileTitle} · 新版本已创建`;
    case "FILE_PARSE_FAILED":
      return `${fileTitle} · 文件解析失败`;
    case "FILE_SCAN_REJECTED":
      return "文件扫描拒绝";
  }
}

function hrefFor(row: ActivityRow, eventType: ActivityEventType): string {
  const projectId = String(row.project_id);
  const taskId = textOrNull(row.research_task_id);
  const runId = textOrNull(row.agent_run_id);
  const fileId = textOrNull(row.research_file_id);

  if (
    eventType === "TASK_SUBMISSION_CREATED" ||
    eventType.startsWith("RESEARCH_TASK_") ||
    eventType.startsWith("REVIEW_")
  ) {
    return taskHref(projectId, taskId);
  }
  if (eventType.startsWith("SCIENTIFIC_DECISION_")) {
    return `/projects/${projectId}/decisions`;
  }
  if (eventType === "RESEARCH_STATE_CHANGED") {
    return `/projects/${projectId}`;
  }
  if (eventType.startsWith("RESEARCH_RESULT_")) {
    return `/projects/${projectId}/evidence`;
  }
  if (eventType.startsWith("AGENT_RUN_")) {
    return runId
      ? `/projects/${projectId}/agent-work#agent-run-${runId}`
      : `/projects/${projectId}/agent-work`;
  }
  return fileHref(projectId, fileId);
}

function translateActivity(row: ActivityRow): CockpitActivityItem {
  const eventType = String(row.event_type) as ActivityEventType;
  return {
    kind: activityKind(eventType),
    id: String(row.id),
    projectId: String(row.project_id),
    projectTitle: String(row.project_title),
    occurredAt: asDate(row.created_at),
    label: labelFor(row, eventType),
    href: hrefFor(row, eventType),
  };
}

export async function loadRecentCockpitActivity(
  tx: TransactionSql,
  projectIds: readonly string[],
  now: Date,
): Promise<CockpitActivityItem[]> {
  if (projectIds.length === 0) return [];

  const windowStart = new Date(now.getTime() - COCKPIT_RECENT_MS);
  const rows = (await tx.unsafe(
    `select
       e.id, e.project_id, p.title as project_title, e.event_type, e.created_at,
       e.payload->>'researchTaskId' as research_task_id,
       e.payload->>'taskSubmissionId' as task_submission_id,
       e.payload->>'reviewRequestId' as review_request_id,
       coalesce(e.payload->>'decisionId', e.payload->>'scientificDecisionId') as decision_id,
       coalesce(e.payload->>'resultId', e.payload->>'newResultId') as result_id,
       e.payload->>'oldResultId' as old_result_id,
       e.payload->>'agentRunId' as agent_run_id,
       coalesce(e.payload->>'researchFileId', rf_from_version.id) as research_file_id,
       e.payload->>'fileVersionId' as file_version_id,
       e.payload->>'dimension' as dimension,
       e.payload->>'state' as dimension_state,
       coalesce(task.title, submission_task.title, review_task.title, agent_task_research.title) as task_title,
       submission.submission_number,
       decision.title as decision_title,
       result_node.title as result_title,
       agent_run.attempt_number as agent_attempt_number,
       coalesce(file_direct.title, rf_from_version.title) as file_title,
       file_version.version_number as file_version_number
     from research_events e
     join research_projects p on p.id = e.project_id
     left join research_tasks task
       on task.id = e.payload->>'researchTaskId'
     left join task_submissions submission
       on submission.id = e.payload->>'taskSubmissionId'
     left join research_tasks submission_task
       on submission_task.id = submission.research_task_id
     left join review_requests review
       on review.id = e.payload->>'reviewRequestId'
     left join task_submissions review_submission
       on review_submission.id = review.task_submission_id
     left join research_tasks review_task
       on review_task.id = review_submission.research_task_id
     left join scientific_decisions decision
       on decision.id = coalesce(e.payload->>'decisionId', e.payload->>'scientificDecisionId')
     left join research_results result
       on result.id = coalesce(e.payload->>'resultId', e.payload->>'newResultId')
     left join research_node_revisions result_revision
       on result_revision.id = result.analysis_revision_id
     left join research_nodes result_node
       on result_node.id = result_revision.node_id
     left join agent_runs agent_run
       on agent_run.id = e.payload->>'agentRunId'
     left join agent_tasks agent_task
       on agent_task.id = agent_run.agent_task_id
     left join research_tasks agent_task_research
       on agent_task_research.id = agent_task.research_task_id
     left join research_files file_direct
       on file_direct.id = e.payload->>'researchFileId'
     left join file_versions file_version
       on file_version.id = e.payload->>'fileVersionId'
     left join research_files rf_from_version
       on rf_from_version.id = file_version.research_file_id
     where e.project_id = any($1::text[])
       and e.event_type = any($2::text[])
       and e.created_at >= $3::timestamptz
       and e.created_at <= $4::timestamptz
     order by e.created_at desc, e.id asc`,
    [
      projectIds,
      [...COCKPIT_ACTIVITY_EVENT_TYPES],
      windowStart.toISOString(),
      now.toISOString(),
    ],
  )) as readonly ActivityRow[];

  const grouped = new Map<string, CockpitActivityItem[]>();
  for (const row of rows) {
    const item = translateActivity(row);
    const items = grouped.get(item.projectId) ?? [];
    if (items.length < 10) items.push(item);
    grouped.set(item.projectId, items);
  }

  return sortActivityItems([...grouped.values()].flat());
}
