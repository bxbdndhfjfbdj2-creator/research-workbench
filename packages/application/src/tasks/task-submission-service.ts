import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import { assertSecretSafe } from "@research-workbench/domain/src/events";
import {
  TASK_SUBMISSION_REF_KINDS,
  TASK_SUBMISSION_REF_RELATIONS,
  type TaskRequirementSnapshot,
  type TaskSubmission,
  type TaskSubmissionRefKind,
  type TaskSubmissionRefRelation,
} from "@research-workbench/domain/src/task-review";
import type {
  ResearchTaskExecutionMode,
  ResearchTaskReviewPolicy,
  ResearchTaskStatus,
} from "@research-workbench/domain/src/research-task";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import {
  assertAccountableTaskOwner,
  assertEligibleReviewer,
  assertTaskProjectAccess,
} from "./task-permissions";

const SUBMISSION_SUMMARY_MAX = 8_000;
const REQUIREMENT_SNAPSHOT_SCHEMA_VERSION = 1;

export type TaskSubmissionContributorInput =
  | { kind: "human_member"; memberId: string }
  | { kind: "agent_run"; runId: string };

export type TaskSubmissionRefInput = {
  kind: TaskSubmissionRefKind;
  refId: string;
  relation: TaskSubmissionRefRelation;
};

export type SubmitResearchTaskInput = {
  summary: string;
  contributors?: TaskSubmissionContributorInput[];
  refs?: TaskSubmissionRefInput[];
  reviewerMemberId?: string | null;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: ResearchTaskStatus;
  assignee_member_id: string;
  execution_mode: ResearchTaskExecutionMode;
  review_policy: ResearchTaskReviewPolicy;
  acceptance_criteria: string[];
  workflow_version: 1 | 2;
};

type SubmissionRow = {
  id: string;
  research_task_id: string;
  project_id: string;
  submission_number: number;
  summary: string;
  requirement_snapshot: TaskRequirementSnapshot;
  requirement_snapshot_schema_version: number;
  submitted_by_member_id: string;
  created_at: Date;
};

type NormalizedContributor =
  | { kind: "human_member"; ref: string }
  | { kind: "agent_run"; ref: string };

function normalizeSummary(value: string): string {
  const summary = value.trim();
  if (!summary) throw new Error("Task submission summary is required");
  if (summary.length > SUBMISSION_SUMMARY_MAX) {
    throw new Error(
      `Task submission summary must be at most ${SUBMISSION_SUMMARY_MAX} characters`,
    );
  }
  return summary;
}

function normalizeContributors(
  inputs: readonly TaskSubmissionContributorInput[] | undefined,
  submittedByMemberId: string,
): NormalizedContributor[] {
  const deduped = new Map<string, NormalizedContributor>();
  const submittedBy: NormalizedContributor = {
    kind: "human_member",
    ref: submittedByMemberId,
  };
  deduped.set(`${submittedBy.kind}:${submittedBy.ref}`, submittedBy);

  for (const input of inputs ?? []) {
    const contributor: NormalizedContributor =
      input.kind === "human_member"
        ? { kind: "human_member", ref: input.memberId }
        : { kind: "agent_run", ref: input.runId };
    if (!contributor.ref.trim()) {
      throw new Error("Task submission contributor reference is required");
    }
    deduped.set(`${contributor.kind}:${contributor.ref}`, contributor);
  }
  return [...deduped.values()];
}

function normalizeRefs(
  inputs: readonly TaskSubmissionRefInput[] | undefined,
): TaskSubmissionRefInput[] {
  const deduped = new Map<string, TaskSubmissionRefInput>();
  for (const input of inputs ?? []) {
    if (!TASK_SUBMISSION_REF_KINDS.includes(input.kind)) {
      throw new Error("Unsupported task submission ref kind");
    }
    if (!TASK_SUBMISSION_REF_RELATIONS.includes(input.relation)) {
      throw new Error("Unsupported task submission ref relation");
    }
    const refId = input.refId.trim();
    if (!refId) throw new Error("Task submission ref id is required");
    const normalized = { ...input, refId };
    deduped.set(
      `${normalized.kind}:${normalized.refId}:${normalized.relation}`,
      normalized,
    );
  }
  return [...deduped.values()];
}

function toSubmission(row: SubmissionRow): TaskSubmission {
  return {
    id: row.id,
    researchTaskId: row.research_task_id,
    projectId: row.project_id,
    submissionNumber: row.submission_number,
    summary: row.summary,
    requirementSnapshot: row.requirement_snapshot,
    requirementSnapshotSchemaVersion: row.requirement_snapshot_schema_version,
    submittedByMemberId: row.submitted_by_member_id,
    createdAt: row.created_at,
  };
}

async function lockTask(tx: TransactionSql, taskId: string): Promise<TaskRow> {
  const rows = (await tx.unsafe(
    `select id, project_id, title, description, status, assignee_member_id,
            execution_mode, review_policy, acceptance_criteria, workflow_version
     from research_tasks
     where id = $1
     for update`,
    [taskId],
  )) as readonly TaskRow[];
  const row = rows[0];
  if (!row) throw new Error("Research task not found");
  return row;
}

async function assertContributorProject(
  tx: TransactionSql,
  projectId: string,
  contributor: NormalizedContributor,
): Promise<void> {
  if (contributor.kind === "human_member") {
    await assertTaskProjectAccess(tx, projectId, contributor.ref);
    return;
  }
  const rows = await tx.unsafe(
    "select 1 from agent_runs where id = $1 and project_id = $2 limit 1",
    [contributor.ref, projectId],
  );
  if (rows.length === 0) {
    throw new Error("Agent run contributor does not belong to the project");
  }
}

async function assertRefProject(
  tx: TransactionSql,
  projectId: string,
  ref: TaskSubmissionRefInput,
): Promise<void> {
  let rows: readonly unknown[];
  if (ref.kind === "file_version") {
    rows = await tx.unsafe(
      `select 1
       from file_versions fv
       join research_files rf on rf.id = fv.research_file_id
       where fv.id = $1 and rf.project_id = $2
       limit 1`,
      [ref.refId, projectId],
    );
  } else if (ref.kind === "research_result") {
    rows = await tx.unsafe(
      "select 1 from research_results where id = $1 and project_id = $2 limit 1",
      [ref.refId, projectId],
    );
  } else if (ref.kind === "research_node_revision") {
    rows = await tx.unsafe(
      `select 1
       from research_node_revisions r
       join research_nodes n on n.id = r.node_id
       where r.id = $1 and n.project_id = $2
       limit 1`,
      [ref.refId, projectId],
    );
  } else {
    rows = await tx.unsafe(
      "select 1 from agent_runs where id = $1 and project_id = $2 limit 1",
      [ref.refId, projectId],
    );
  }
  if (rows.length === 0) {
    throw new Error(`Task submission ${ref.kind} ref does not belong to the project`);
  }
}

async function nextSubmissionNumber(
  tx: TransactionSql,
  taskId: string,
): Promise<number> {
  const rows = (await tx.unsafe(
    `select coalesce(max(submission_number), 0)::int + 1 as next_number
     from task_submissions
     where research_task_id = $1`,
    [taskId],
  )) as readonly { next_number: number }[];
  return Number(rows[0]?.next_number ?? 1);
}

export async function submitResearchTask(
  sql: DatabaseSql,
  taskId: string,
  input: SubmitResearchTaskInput,
  actor: ActorRef,
): Promise<{ submission: TaskSubmission; reviewRequestId: string | null }> {
  assertHumanActor(actor);
  const summary = normalizeSummary(input.summary);
  const contributors = normalizeContributors(input.contributors, actor.id);
  const refs = normalizeRefs(input.refs);

  return runInTransaction(sql, async (tx) => {
    const task = await lockTask(tx, taskId);
    if (task.workflow_version !== 2) {
      throw new Error("Formal task submission requires workflow v2");
    }
    if (task.status !== "in_progress") {
      throw new Error("Research task state must be in_progress for formal submission");
    }
    await assertAccountableTaskOwner(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );

    if (task.review_policy === "required" && !input.reviewerMemberId) {
      throw new Error("A reviewer is required for this task submission");
    }
    if (task.review_policy === "none" && input.reviewerMemberId) {
      throw new Error("Reviewer must be omitted when review policy is none");
    }

    for (const contributor of contributors) {
      await assertContributorProject(tx, task.project_id, contributor);
    }
    for (const ref of refs) {
      await assertRefProject(tx, task.project_id, ref);
    }

    const snapshot: TaskRequirementSnapshot = {
      title: task.title,
      description: task.description,
      acceptanceCriteria: [...task.acceptance_criteria],
      executionMode: task.execution_mode,
      reviewPolicy: task.review_policy,
    };
    assertSecretSafe(snapshot);

    const submissionId = randomUUID();
    const submissionNumber = await nextSubmissionNumber(tx, task.id);
    const submissionRows = (await tx.unsafe(
      `insert into task_submissions
        (id, research_task_id, project_id, submission_number, summary,
         requirement_snapshot, requirement_snapshot_schema_version,
         submitted_by_member_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning id, research_task_id, project_id, submission_number, summary,
                 requirement_snapshot, requirement_snapshot_schema_version,
                 submitted_by_member_id, created_at`,
      [
        submissionId,
        task.id,
        task.project_id,
        submissionNumber,
        summary,
        JSON.stringify(snapshot),
        REQUIREMENT_SNAPSHOT_SCHEMA_VERSION,
        actor.id,
      ],
    )) as readonly SubmissionRow[];
    const submissionRow = submissionRows[0];
    if (!submissionRow) throw new Error("Task submission insert returned no row");

    for (const contributor of contributors) {
      await tx.unsafe(
        `insert into task_submission_contributors
          (id, submission_id, contributor_kind, contributor_ref)
         values ($1, $2, $3, $4)`,
        [randomUUID(), submissionId, contributor.kind, contributor.ref],
      );
    }
    for (const ref of refs) {
      await tx.unsafe(
        `insert into task_submission_refs
          (id, submission_id, ref_kind, ref_id, relation)
         values ($1, $2, $3, $4, $5)`,
        [randomUUID(), submissionId, ref.kind, ref.refId, ref.relation],
      );
    }

    let reviewRequestId: string | null = null;
    if (task.review_policy === "required") {
      const reviewerMemberId = input.reviewerMemberId as string;
      await assertEligibleReviewer(
        tx,
        task.project_id,
        submissionId,
        reviewerMemberId,
      );

      reviewRequestId = randomUUID();
      await tx.unsafe(
        `insert into review_requests
          (id, project_id, task_submission_id, reviewer_member_id, status,
           created_by_member_id)
         values ($1, $2, $3, $4, 'pending', $5)`,
        [
          reviewRequestId,
          task.project_id,
          submissionId,
          reviewerMemberId,
          actor.id,
        ],
      );
      await tx.unsafe(
        `insert into review_actions
          (id, review_request_id, action, actor_type, actor_id,
           new_reviewer_member_id, resulting_status)
         values ($1, $2, 'assigned', 'human', $3, $4, 'pending')`,
        [randomUUID(), reviewRequestId, actor.id, reviewerMemberId],
      );
      await tx.unsafe(
        `update research_tasks
         set status = 'awaiting_review', updated_at = now()
         where id = $1`,
        [task.id],
      );

      await appendResearchEvent(tx, {
        id: randomUUID(),
        projectId: task.project_id,
        eventType: "REVIEW_REQUEST_CREATED",
        actor,
        payload: {
          reviewRequestId,
          researchTaskId: task.id,
          taskSubmissionId: submissionId,
          reviewerMemberId,
        },
      });
      await enqueueOutbox(tx, {
        id: randomUUID(),
        eventType: "research.task.review.created",
        payload: {
          projectId: task.project_id,
          reviewRequestId,
          researchTaskId: task.id,
          taskSubmissionId: submissionId,
        },
      });
    }

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: task.project_id,
      eventType: "TASK_SUBMISSION_CREATED",
      actor,
      payload: {
        researchTaskId: task.id,
        taskSubmissionId: submissionId,
        submissionNumber,
        reviewPolicy: task.review_policy,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.submission.created",
      payload: {
        projectId: task.project_id,
        researchTaskId: task.id,
        taskSubmissionId: submissionId,
        submissionNumber,
      },
    });

    return {
      submission: toSubmission(submissionRow),
      reviewRequestId,
    };
  });
}
