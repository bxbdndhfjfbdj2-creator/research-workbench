import "server-only";

import { authorizeProjectAccess } from "@research-workbench/application/src/auth/authorize";
import type { ResearchTaskExecutionMode, ResearchTaskReviewPolicy, ResearchTaskStatus } from "@research-workbench/domain/src/research-task";
import type { ReviewRequestStatus, TaskRequirementSnapshot, TaskSubmissionRefKind, TaskSubmissionRefRelation } from "@research-workbench/domain/src/task-review";
import { getWebDbClient, type CurrentMember } from "./queries";

export type ResearchWorkTaskListItem = {
  id: string;
  title: string;
  status: ResearchTaskStatus;
  owner: { id: string; displayName: string };
  executionMode: ResearchTaskExecutionMode;
  reviewPolicy: ResearchTaskReviewPolicy;
  latestSubmission: {
    id: string;
    submissionNumber: number;
    createdAt: Date;
  } | null;
  currentReview: {
    id: string;
    reviewerMemberId: string;
    status: ReviewRequestStatus;
  } | null;
  agentRunCount: number;
  latestAgentRunState: string | null;
};

export type ProjectResearchWorkViewModel = {
  projectId: string;
  projectTitle: string;
  tasks: ResearchWorkTaskListItem[];
};

export type SubmissionContributorView = {
  kind: "human_member" | "agent_run";
  id: string;
  displayName: string;
};

export type SubmissionRefView = {
  kind: TaskSubmissionRefKind;
  id: string;
  relation: TaskSubmissionRefRelation;
  label: string;
  accessClass: string | null;
  versionNumber: number | null;
};

export type SubmissionReviewView = {
  id: string;
  reviewerMemberId: string;
  reviewerName: string;
  status: ReviewRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  linkedDecisions: Array<{
    id: string;
    title: string;
    status: string;
  }>;
};

export type TaskSubmissionView = {
  id: string;
  submissionNumber: number;
  summary: string;
  requirementSnapshot: TaskRequirementSnapshot;
  submittedByMemberId: string;
  submitterName: string;
  createdAt: Date;
  contributors: SubmissionContributorView[];
  refs: SubmissionRefView[];
  review: SubmissionReviewView | null;
};

export type ResearchTaskDetailViewModel = {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  description: string | null;
  status: ResearchTaskStatus;
  owner: { id: string; displayName: string };
  executionMode: ResearchTaskExecutionMode;
  reviewPolicy: ResearchTaskReviewPolicy;
  acceptanceCriteria: string[];
  workflowVersion: 1 | 2;
  submissions: TaskSubmissionView[];
};

export type ReviewInboxItem = {
  id: string;
  projectId: string;
  projectTitle: string;
  taskId: string;
  taskTitle: string;
  submissionId: string;
  submissionNumber: number;
  submitterName: string;
  status: "pending" | "awaiting_scientific_decision";
  actionable: boolean;
  waitingSince: Date;
};

export async function getProjectResearchWork(
  member: CurrentMember,
  projectId: string,
): Promise<ProjectResearchWorkViewModel | null> {
  const db = getWebDbClient();
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const projectRows = await db.sql.unsafe(
    "select id, title from research_projects where id = $1 limit 1",
    [projectId],
  );
  const project = projectRows[0];
  if (!project) return null;

  const rows = await db.sql.unsafe(
    `select
       t.id, t.title, t.status, t.execution_mode, t.review_policy,
       owner.id as owner_id, owner.display_name as owner_name,
       latest_submission.id as submission_id,
       latest_submission.submission_number,
       latest_submission.created_at as submission_created_at,
       rr.id as review_id, rr.reviewer_member_id, rr.status as review_status,
       coalesce(agent_stats.run_count, 0)::int as agent_run_count,
       agent_stats.latest_state as latest_agent_run_state
     from research_tasks t
     join members owner on owner.id = t.assignee_member_id
     left join lateral (
       select id, submission_number, created_at
       from task_submissions
       where research_task_id = t.id
       order by submission_number desc, id desc
       limit 1
     ) latest_submission on true
     left join review_requests rr
       on rr.task_submission_id = latest_submission.id
     left join lateral (
       select
         count(ar.id)::int as run_count,
         (array_agg(ar.state order by ar.created_at desc, ar.id desc))[1] as latest_state
       from agent_tasks at
       join agent_runs ar on ar.agent_task_id = at.id
       where at.research_task_id = t.id
     ) agent_stats on true
     where t.project_id = $1
     order by t.created_at asc, t.id asc`,
    [projectId],
  );

  return {
    projectId: String(project.id),
    projectTitle: String(project.title),
    tasks: rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: row.status as ResearchTaskStatus,
      owner: {
        id: String(row.owner_id),
        displayName: String(row.owner_name),
      },
      executionMode: row.execution_mode as ResearchTaskExecutionMode,
      reviewPolicy: row.review_policy as ResearchTaskReviewPolicy,
      latestSubmission: row.submission_id
        ? {
            id: String(row.submission_id),
            submissionNumber: Number(row.submission_number),
            createdAt: new Date(row.submission_created_at as string | Date),
          }
        : null,
      currentReview: row.review_id
        ? {
            id: String(row.review_id),
            reviewerMemberId: String(row.reviewer_member_id),
            status: row.review_status as ReviewRequestStatus,
          }
        : null,
      agentRunCount: Number(row.agent_run_count ?? 0),
      latestAgentRunState: row.latest_agent_run_state
        ? String(row.latest_agent_run_state)
        : null,
    })),
  };
}

async function loadSubmissionContributors(
  submissionId: string,
): Promise<SubmissionContributorView[]> {
  const db = getWebDbClient();
  const rows = await db.sql.unsafe(
    `select c.contributor_kind, c.contributor_ref,
            m.display_name as member_name,
            ar.attempt_number
     from task_submission_contributors c
     left join members m
       on c.contributor_kind = 'human_member'
      and m.id = c.contributor_ref
     left join agent_runs ar
       on c.contributor_kind = 'agent_run'
      and ar.id = c.contributor_ref
     where c.submission_id = $1
     order by c.contributor_kind asc, c.contributor_ref asc`,
    [submissionId],
  );
  return rows.map((row) => {
    const kind = row.contributor_kind as "human_member" | "agent_run";
    const id = String(row.contributor_ref);
    return {
      kind,
      id,
      displayName:
        kind === "human_member"
          ? String(row.member_name ?? id)
          : row.attempt_number !== null && row.attempt_number !== undefined
            ? `Agent run #${Number(row.attempt_number)}`
            : `Agent run ${id}`,
    };
  });
}

async function loadSubmissionRefs(
  submissionId: string,
): Promise<SubmissionRefView[]> {
  const db = getWebDbClient();
  const rows = await db.sql.unsafe(
    `select
       sr.ref_kind, sr.ref_id, sr.relation,
       fv.version_number as file_version_number,
       rf.title as file_title,
       rf.access_class as file_access_class,
       result.id as result_id,
       result_node.title as result_title,
       revision.id as revision_id,
       revision_node.title as revision_title,
       ar.attempt_number as agent_attempt_number
     from task_submission_refs sr
     left join file_versions fv
       on sr.ref_kind = 'file_version'
      and fv.id = sr.ref_id
     left join research_files rf
       on rf.id = fv.research_file_id
     left join research_results result
       on sr.ref_kind = 'research_result'
      and result.id = sr.ref_id
     left join research_node_revisions result_revision
       on result_revision.id = result.analysis_revision_id
     left join research_nodes result_node
       on result_node.id = result_revision.node_id
     left join research_node_revisions revision
       on sr.ref_kind = 'research_node_revision'
      and revision.id = sr.ref_id
     left join research_nodes revision_node
       on revision_node.id = revision.node_id
     left join agent_runs ar
       on sr.ref_kind = 'agent_run'
      and ar.id = sr.ref_id
     where sr.submission_id = $1
     order by sr.created_at asc, sr.id asc`,
    [submissionId],
  );

  return rows.map((row) => {
    const kind = row.ref_kind as TaskSubmissionRefKind;
    let label: string;
    if (kind === "file_version") {
      label = row.file_title ? String(row.file_title) : String(row.ref_id);
    } else if (kind === "research_result") {
      label = row.result_title
        ? String(row.result_title)
        : `Research result ${String(row.ref_id)}`;
    } else if (kind === "research_node_revision") {
      label = row.revision_title
        ? String(row.revision_title)
        : `Research revision ${String(row.ref_id)}`;
    } else {
      label =
        row.agent_attempt_number !== null && row.agent_attempt_number !== undefined
          ? `Agent run #${Number(row.agent_attempt_number)}`
          : `Agent run ${String(row.ref_id)}`;
    }

    return {
      kind,
      id: String(row.ref_id),
      relation: row.relation as TaskSubmissionRefRelation,
      label,
      accessClass:
        kind === "file_version" && row.file_access_class
          ? String(row.file_access_class)
          : null,
      versionNumber:
        kind === "file_version" &&
        row.file_version_number !== null &&
        row.file_version_number !== undefined
          ? Number(row.file_version_number)
          : null,
    };
  });
}

async function loadSubmissionReview(
  submissionId: string,
): Promise<SubmissionReviewView | null> {
  const db = getWebDbClient();
  const rows = await db.sql.unsafe(
    `select rr.id, rr.reviewer_member_id, reviewer.display_name as reviewer_name,
            rr.status, rr.created_at, rr.updated_at
     from review_requests rr
     join members reviewer on reviewer.id = rr.reviewer_member_id
     where rr.task_submission_id = $1
     limit 1`,
    [submissionId],
  );
  const row = rows[0];
  if (!row) return null;

  const decisions = await db.sql.unsafe(
    `select d.id, d.title, d.status
     from review_decision_links link
     join scientific_decisions d on d.id = link.scientific_decision_id
     where link.review_request_id = $1
     order by link.created_at asc, link.id asc`,
    [String(row.id)],
  );

  return {
    id: String(row.id),
    reviewerMemberId: String(row.reviewer_member_id),
    reviewerName: String(row.reviewer_name),
    status: row.status as ReviewRequestStatus,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
    linkedDecisions: decisions.map((decision) => ({
      id: String(decision.id),
      title: String(decision.title),
      status: String(decision.status),
    })),
  };
}

export async function getResearchTaskDetail(
  member: CurrentMember,
  taskId: string,
): Promise<ResearchTaskDetailViewModel | null> {
  const db = getWebDbClient();
  const taskRows = await db.sql.unsafe(
    `select t.id, t.project_id, p.title as project_title,
            t.title, t.description, t.status, t.execution_mode, t.review_policy,
            t.acceptance_criteria, t.workflow_version,
            owner.id as owner_id, owner.display_name as owner_name
     from research_tasks t
     join research_projects p on p.id = t.project_id
     join members owner on owner.id = t.assignee_member_id
     where t.id = $1
     limit 1`,
    [taskId],
  );
  const task = taskRows[0];
  if (!task) return null;

  const projectId = String(task.project_id);
  try {
    await authorizeProjectAccess(db.sql, member.id, projectId, "read");
  } catch {
    return null;
  }

  const submissionRows = await db.sql.unsafe(
    `select ts.id, ts.submission_number, ts.summary, ts.requirement_snapshot,
            ts.submitted_by_member_id, submitter.display_name as submitter_name,
            ts.created_at
     from task_submissions ts
     join members submitter on submitter.id = ts.submitted_by_member_id
     where ts.research_task_id = $1
     order by ts.submission_number asc, ts.id asc`,
    [taskId],
  );

  const submissions = await Promise.all(
    submissionRows.map(async (row) => {
      const submissionId = String(row.id);
      const [contributors, refs, review] = await Promise.all([
        loadSubmissionContributors(submissionId),
        loadSubmissionRefs(submissionId),
        loadSubmissionReview(submissionId),
      ]);
      return {
        id: submissionId,
        submissionNumber: Number(row.submission_number),
        summary: String(row.summary),
        requirementSnapshot: row.requirement_snapshot as TaskRequirementSnapshot,
        submittedByMemberId: String(row.submitted_by_member_id),
        submitterName: String(row.submitter_name),
        createdAt: new Date(row.created_at as string | Date),
        contributors,
        refs,
        review,
      } satisfies TaskSubmissionView;
    }),
  );

  return {
    id: String(task.id),
    projectId,
    projectTitle: String(task.project_title),
    title: String(task.title),
    description: task.description ? String(task.description) : null,
    status: task.status as ResearchTaskStatus,
    owner: {
      id: String(task.owner_id),
      displayName: String(task.owner_name),
    },
    executionMode: task.execution_mode as ResearchTaskExecutionMode,
    reviewPolicy: task.review_policy as ResearchTaskReviewPolicy,
    acceptanceCriteria: Array.isArray(task.acceptance_criteria)
      ? (task.acceptance_criteria as string[])
      : [],
    workflowVersion: Number(task.workflow_version) as 1 | 2,
    submissions,
  };
}

export async function listMyReviewInbox(
  member: CurrentMember,
): Promise<ReviewInboxItem[]> {
  const db = getWebDbClient();
  const rows = await db.sql.unsafe(
    `select rr.id, rr.status, rr.created_at,
            p.id as project_id, p.title as project_title,
            task.id as task_id, task.title as task_title,
            ts.id as submission_id, ts.submission_number,
            submitter.display_name as submitter_name
     from review_requests rr
     join task_submissions ts on ts.id = rr.task_submission_id
     join research_tasks task on task.id = ts.research_task_id
     join research_projects p on p.id = rr.project_id
     join research_portfolios rp on rp.id = p.portfolio_id
     join members submitter on submitter.id = ts.submitted_by_member_id
     left join project_memberships pm
       on pm.project_id = p.id and pm.member_id = $1
     where rr.reviewer_member_id = $1
       and rr.status in ('pending', 'awaiting_scientific_decision')
       and rp.team_id = $2
       and ($3 = 'lead' or pm.id is not null)
     order by rr.created_at asc, rr.id asc`,
    [member.id, member.teamId, member.organizationRole],
  );

  return rows.map((row) => {
    const status = row.status as "pending" | "awaiting_scientific_decision";
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      projectTitle: String(row.project_title),
      taskId: String(row.task_id),
      taskTitle: String(row.task_title),
      submissionId: String(row.submission_id),
      submissionNumber: Number(row.submission_number),
      submitterName: String(row.submitter_name),
      status,
      actionable: status === "pending",
      waitingSince: new Date(row.created_at as string | Date),
    };
  });
}
