import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import {
  RESEARCH_TASK_EXECUTION_MODES,
  RESEARCH_TASK_REVIEW_POLICIES,
  type ResearchTask,
  type ResearchTaskExecutionMode,
  type ResearchTaskReviewPolicy,
  type ResearchTaskStatus,
} from "@research-workbench/domain/src/research-task";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";
import {
  assertAccountableTaskOwner,
  assertEligibleTaskOwner,
  assertProjectOrTeamLead,
  assertTaskOwnerOrLead,
  assertTaskProjectAccess,
} from "./task-permissions";

const TASK_TITLE_MAX = 200;
const TASK_DESCRIPTION_MAX = 4_000;
const ACCEPTANCE_CRITERIA_MAX = 20;
const ACCEPTANCE_CRITERION_MAX = 1_000;

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
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type CreateResearchTaskInput = {
  title: string;
  description?: string | null;
  assigneeMemberId?: string | null;
  executionMode?: ResearchTaskExecutionMode;
  reviewPolicy?: ResearchTaskReviewPolicy;
  acceptanceCriteria?: string[];
};

type RequirementUpdateInput = {
  title: string;
  description: string | null;
  acceptanceCriteria: string[];
};

type TaskEventPayload = Record<string, string | number>;

function toTask(row: TaskRow): ResearchTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeMemberId: row.assignee_member_id,
    executionMode: row.execution_mode,
    reviewPolicy: row.review_policy,
    acceptanceCriteria: row.acceptance_criteria,
    workflowVersion: row.workflow_version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("Research task title is required");
  if (title.length > TASK_TITLE_MAX) {
    throw new Error(`Research task title must be at most ${TASK_TITLE_MAX} characters`);
  }
  return title;
}

function normalizeDescription(value: string | null | undefined): string | null {
  const description = value?.trim() || null;
  if (description && description.length > TASK_DESCRIPTION_MAX) {
    throw new Error(
      `Research task description must be at most ${TASK_DESCRIPTION_MAX} characters`,
    );
  }
  return description;
}

function normalizeAcceptanceCriteria(values: readonly string[] | undefined): string[] {
  const criteria = values ?? [];
  if (criteria.length > ACCEPTANCE_CRITERIA_MAX) {
    throw new Error(
      `Research task acceptance criteria are limited to ${ACCEPTANCE_CRITERIA_MAX} entries`,
    );
  }
  return criteria.map((value) => {
    const criterion = value.trim();
    if (!criterion) throw new Error("Research task acceptance criteria cannot be empty");
    if (criterion.length > ACCEPTANCE_CRITERION_MAX) {
      throw new Error(
        `Research task acceptance criterion must be at most ${ACCEPTANCE_CRITERION_MAX} characters`,
      );
    }
    return criterion;
  });
}

function assertExecutionMode(mode: ResearchTaskExecutionMode): void {
  if (!RESEARCH_TASK_EXECUTION_MODES.includes(mode)) {
    throw new Error("Unsupported research task execution mode");
  }
}

function assertReviewPolicy(policy: ResearchTaskReviewPolicy): void {
  if (!RESEARCH_TASK_REVIEW_POLICIES.includes(policy)) {
    throw new Error("Unsupported research task review policy");
  }
}

async function lockTask(tx: TransactionSql, taskId: string): Promise<TaskRow> {
  const rows = (await tx.unsafe(
    `select id, project_id, title, description, status, assignee_member_id,
            execution_mode, review_policy, acceptance_criteria, workflow_version,
            created_by, created_at, updated_at
     from research_tasks
     where id = $1
     for update`,
    [taskId],
  )) as readonly TaskRow[];
  const row = rows[0];
  if (!row) throw new Error("Research task not found");
  return row;
}

async function recordTaskEvent(
  tx: TransactionSql,
  task: TaskRow,
  eventType: string,
  outboxType: string,
  actor: ActorRef,
  payload: TaskEventPayload = {},
): Promise<void> {
  const eventPayload = {
    researchTaskId: task.id,
    ...payload,
  };
  await appendResearchEvent(tx, {
    id: randomUUID(),
    projectId: task.project_id,
    eventType,
    actor,
    payload: eventPayload,
  });
  await enqueueOutbox(tx, {
    id: randomUUID(),
    eventType: outboxType,
    payload: {
      projectId: task.project_id,
      ...eventPayload,
    },
  });
}

async function ensureWorkflowV2ForMutation(
  tx: TransactionSql,
  task: TaskRow,
  actor: ActorRef,
): Promise<TaskRow> {
  await assertEligibleTaskOwner(
    tx,
    task.project_id,
    task.assignee_member_id,
  );
  if (task.workflow_version === 2) return task;
  if (task.status === "cancelled") {
    throw new Error("Cancelled legacy research task is terminal");
  }

  const rows = (await tx.unsafe(
    `update research_tasks
     set workflow_version = 2, updated_at = now()
     where id = $1
     returning id, project_id, title, description, status, assignee_member_id,
               execution_mode, review_policy, acceptance_criteria, workflow_version,
               created_by, created_at, updated_at`,
    [task.id],
  )) as readonly TaskRow[];
  const upgraded = rows[0];
  if (!upgraded) throw new Error("Research task workflow upgrade returned no row");

  await recordTaskEvent(
    tx,
    upgraded,
    "RESEARCH_TASK_WORKFLOW_UPGRADED",
    "research.task.workflow.upgraded",
    actor,
    { fromVersion: 1, toVersion: 2 },
  );
  return upgraded;
}

async function transitionResearchTask(
  sql: DatabaseSql,
  taskId: string,
  allowedStatuses: readonly ResearchTaskStatus[],
  nextStatus: ResearchTaskStatus,
  eventType: string,
  outboxType: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertTaskOwnerOrLead(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );
    if (!allowedStatuses.includes(task.status)) {
      throw new Error(
        `Research task state must be ${allowedStatuses.join(" or ")} for this action`,
      );
    }

    const rows = (await tx.unsafe(
      `update research_tasks
       set status = $2, updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id, nextStatus],
    )) as readonly TaskRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Research task transition returned no row");
    await recordTaskEvent(tx, updated, eventType, outboxType, actor);
    return toTask(updated);
  });
}

export async function createResearchTask(
  sql: DatabaseSql,
  projectId: string,
  input: CreateResearchTaskInput,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  const title = normalizeTitle(input.title);
  const description = normalizeDescription(input.description);
  const acceptanceCriteria = normalizeAcceptanceCriteria(input.acceptanceCriteria);
  const executionMode = input.executionMode ?? "human";
  const reviewPolicy = input.reviewPolicy ?? "none";
  assertExecutionMode(executionMode);
  assertReviewPolicy(reviewPolicy);

  return runInTransaction(sql, async (tx) => {
    await assertTaskProjectAccess(tx, projectId, actor.id);

    const assigneeMemberId = input.assigneeMemberId ?? actor.id;
    await assertEligibleTaskOwner(tx, projectId, assigneeMemberId);
    if (assigneeMemberId !== actor.id) {
      await assertProjectOrTeamLead(tx, projectId, actor.id);
    }

    const id = randomUUID();
    const rows = (await tx.unsafe(
      `insert into research_tasks
        (id, project_id, title, description, status, assignee_member_id,
         execution_mode, review_policy, acceptance_criteria, workflow_version, created_by)
       values ($1, $2, $3, $4, 'open', $5, $6, $7, $8::jsonb, 2, $9)
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [
        id,
        projectId,
        title,
        description,
        assigneeMemberId,
        executionMode,
        reviewPolicy,
        JSON.stringify(acceptanceCriteria),
        actor.id,
      ],
    )) as readonly TaskRow[];

    const row = rows[0];
    if (!row) throw new Error("Research task insert returned no row");
    await recordTaskEvent(
      tx,
      row,
      "RESEARCH_TASK_CREATED",
      "research.task.created",
      actor,
      {
        assigneeMemberId,
        executionMode,
        reviewPolicy,
      },
    );
    return toTask(row);
  });
}

export async function updateResearchTaskRequirements(
  sql: DatabaseSql,
  taskId: string,
  input: RequirementUpdateInput,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  const title = normalizeTitle(input.title);
  const description = normalizeDescription(input.description);
  const acceptanceCriteria = normalizeAcceptanceCriteria(input.acceptanceCriteria);

  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertTaskOwnerOrLead(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );
    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error("Research task state does not allow requirement changes");
    }

    const rows = (await tx.unsafe(
      `update research_tasks
       set title = $2,
           description = $3,
           acceptance_criteria = $4::jsonb,
           updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id, title, description, JSON.stringify(acceptanceCriteria)],
    )) as readonly TaskRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Research task requirement update returned no row");
    await recordTaskEvent(
      tx,
      updated,
      "RESEARCH_TASK_REQUIREMENTS_CHANGED",
      "research.task.requirements.changed",
      actor,
    );
    return toTask(updated);
  });
}

export async function setResearchTaskReviewPolicy(
  sql: DatabaseSql,
  taskId: string,
  reviewPolicy: ResearchTaskReviewPolicy,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  assertReviewPolicy(reviewPolicy);

  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertTaskOwnerOrLead(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );
    if (!["open", "in_progress", "blocked"].includes(task.status)) {
      throw new Error("Research task state does not allow review policy changes");
    }

    const submissions = await tx.unsafe(
      "select 1 from task_submissions where research_task_id = $1 limit 1",
      [task.id],
    );
    if (submissions.length > 0) {
      throw new Error("Research task review policy is locked after the first submission");
    }
    if (task.review_policy === reviewPolicy) return toTask(task);

    const rows = (await tx.unsafe(
      `update research_tasks
       set review_policy = $2, updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id, reviewPolicy],
    )) as readonly TaskRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Research task review policy update returned no row");
    await recordTaskEvent(
      tx,
      updated,
      "RESEARCH_TASK_REVIEW_POLICY_CHANGED",
      "research.task.review_policy.changed",
      actor,
      { previousReviewPolicy: task.review_policy, reviewPolicy },
    );
    return toTask(updated);
  });
}

export async function setResearchTaskExecutionMode(
  sql: DatabaseSql,
  taskId: string,
  executionMode: ResearchTaskExecutionMode,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);
  assertExecutionMode(executionMode);

  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertTaskOwnerOrLead(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );
    if (!["open", "in_progress", "blocked"].includes(task.status)) {
      throw new Error("Research task state does not allow execution mode changes");
    }
    if (task.execution_mode === executionMode) return toTask(task);

    const rows = (await tx.unsafe(
      `update research_tasks
       set execution_mode = $2, updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id, executionMode],
    )) as readonly TaskRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Research task execution mode update returned no row");
    await recordTaskEvent(
      tx,
      updated,
      "RESEARCH_TASK_EXECUTION_MODE_CHANGED",
      "research.task.execution_mode.changed",
      actor,
      { previousExecutionMode: task.execution_mode, executionMode },
    );
    return toTask(updated);
  });
}

export async function assignResearchTaskOwner(
  sql: DatabaseSql,
  taskId: string,
  memberId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);

  return runInTransaction(sql, async (tx) => {
    const task = await lockTask(tx, taskId);
    await assertProjectOrTeamLead(tx, task.project_id, actor.id);
    await assertEligibleTaskOwner(tx, task.project_id, memberId);
    if (task.workflow_version === 1 && task.status === "cancelled") {
      throw new Error("Cancelled legacy research task is terminal");
    }
    if (task.workflow_version === 2 && task.assignee_member_id === memberId) {
      return toTask(task);
    }

    const rows = (await tx.unsafe(
      `update research_tasks
       set assignee_member_id = $2,
           workflow_version = case when workflow_version = 1 then 2 else workflow_version end,
           updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id, memberId],
    )) as readonly TaskRow[];
    const updated = rows[0];
    if (!updated) throw new Error("Research task owner update returned no row");

    if (task.workflow_version === 1) {
      await recordTaskEvent(
        tx,
        updated,
        "RESEARCH_TASK_WORKFLOW_UPGRADED",
        "research.task.workflow.upgraded",
        actor,
        { fromVersion: 1, toVersion: 2 },
      );
    }
    if (task.assignee_member_id !== memberId) {
      await recordTaskEvent(
        tx,
        updated,
        "RESEARCH_TASK_OWNER_CHANGED",
        "research.task.owner.changed",
        actor,
        {
          previousOwnerMemberId: task.assignee_member_id,
          ownerMemberId: memberId,
        },
      );
    }
    return toTask(updated);
  });
}

export async function startResearchTask(
  sql: DatabaseSql,
  taskId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  return transitionResearchTask(
    sql,
    taskId,
    ["open"],
    "in_progress",
    "RESEARCH_TASK_STARTED",
    "research.task.started",
    actor,
  );
}

export async function blockResearchTask(
  sql: DatabaseSql,
  taskId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  return transitionResearchTask(
    sql,
    taskId,
    ["in_progress"],
    "blocked",
    "RESEARCH_TASK_BLOCKED",
    "research.task.blocked",
    actor,
  );
}

export async function unblockResearchTask(
  sql: DatabaseSql,
  taskId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  return transitionResearchTask(
    sql,
    taskId,
    ["blocked"],
    "in_progress",
    "RESEARCH_TASK_UNBLOCKED",
    "research.task.unblocked",
    actor,
  );
}

export async function cancelResearchTask(
  sql: DatabaseSql,
  taskId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);

  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertTaskOwnerOrLead(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );

    if (["open", "in_progress", "blocked"].includes(task.status)) {
      const rows = (await tx.unsafe(
        `update research_tasks
         set status = 'cancelled', updated_at = now()
         where id = $1
         returning id, project_id, title, description, status, assignee_member_id,
                   execution_mode, review_policy, acceptance_criteria, workflow_version,
                   created_by, created_at, updated_at`,
        [task.id],
      )) as readonly TaskRow[];
      const cancelled = rows[0];
      if (!cancelled) throw new Error("Research task cancellation returned no row");
      await recordTaskEvent(
        tx,
        cancelled,
        "RESEARCH_TASK_CANCELLED",
        "research.task.cancelled",
        actor,
      );
      return toTask(cancelled);
    }

    if (task.status !== "awaiting_review") {
      throw new Error("Research task state does not allow cancellation");
    }

    const reviewRows = (await tx.unsafe(
      `select rr.id, rr.status, rr.task_submission_id
       from review_requests rr
       join task_submissions ts on ts.id = rr.task_submission_id
       where ts.research_task_id = $1
       order by ts.submission_number desc
       limit 1
       for update of rr`,
      [task.id],
    )) as readonly {
      id: string;
      status: string;
      task_submission_id: string;
    }[];
    const review = reviewRows[0];
    if (!review) {
      throw new Error("Awaiting-review task has no review request");
    }
    if (review.status === "awaiting_scientific_decision") {
      throw new Error(
        "Research task cannot be cancelled while review awaits a scientific decision",
      );
    }
    if (review.status !== "pending") {
      throw new Error("Research task does not have a pending review to cancel");
    }

    await tx.unsafe(
      `update review_requests
       set status = 'cancelled', updated_at = now()
       where id = $1`,
      [review.id],
    );
    await tx.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id, resulting_status)
       values ($1, $2, 'cancel', 'human', $3, 'cancelled')`,
      [randomUUID(), review.id, actor.id],
    );

    const taskRows = (await tx.unsafe(
      `update research_tasks
       set status = 'cancelled', updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id],
    )) as readonly TaskRow[];
    const cancelled = taskRows[0];
    if (!cancelled) throw new Error("Research task cancellation returned no row");

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: task.project_id,
      eventType: "REVIEW_CANCELLED",
      actor,
      payload: {
        reviewRequestId: review.id,
        researchTaskId: task.id,
        taskSubmissionId: review.task_submission_id,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.task.review.cancelled",
      payload: {
        projectId: task.project_id,
        reviewRequestId: review.id,
        researchTaskId: task.id,
        taskSubmissionId: review.task_submission_id,
      },
    });
    await recordTaskEvent(
      tx,
      cancelled,
      "RESEARCH_TASK_CANCELLED",
      "research.task.cancelled",
      actor,
    );
    return toTask(cancelled);
  });
}

export async function reopenResearchTask(
  sql: DatabaseSql,
  taskId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  return transitionResearchTask(
    sql,
    taskId,
    ["completed"],
    "in_progress",
    "RESEARCH_TASK_REOPENED",
    "research.task.reopened",
    actor,
  );
}

export async function completeUnreviewedTask(
  sql: DatabaseSql,
  taskId: string,
  submissionId: string,
  actor: ActorRef,
): Promise<ResearchTask> {
  assertHumanActor(actor);

  return runInTransaction(sql, async (tx) => {
    let task = await lockTask(tx, taskId);
    task = await ensureWorkflowV2ForMutation(tx, task, actor);
    await assertAccountableTaskOwner(
      tx,
      task.project_id,
      task.assignee_member_id,
      actor.id,
    );
    if (task.status !== "in_progress") {
      throw new Error("Research task state must be in_progress for completion");
    }
    if (task.review_policy !== "none") {
      throw new Error("Research task requires review before completion");
    }

    const submissions = (await tx.unsafe(
      `select id, submission_number
       from task_submissions
       where research_task_id = $1
       order by submission_number desc
       limit 1`,
      [task.id],
    )) as readonly { id: string; submission_number: number }[];
    const latest = submissions[0];
    if (!latest) throw new Error("Research task has no formal submission");
    if (latest.id !== submissionId) {
      throw new Error("Completion must accept the latest submission for this task");
    }

    const priorAcceptances = await tx.unsafe(
      `select 1
       from research_events
       where project_id = $1
         and event_type = 'RESEARCH_TASK_COMPLETED'
         and payload->>'researchTaskId' = $2
         and payload->>'submissionId' = $3
       limit 1`,
      [task.project_id, task.id, latest.id],
    );
    if (priorAcceptances.length > 0) {
      throw new Error(
        "Reopened research task requires a new formal submission before completion",
      );
    }

    const rows = (await tx.unsafe(
      `update research_tasks
       set status = 'completed', updated_at = now()
       where id = $1
       returning id, project_id, title, description, status, assignee_member_id,
                 execution_mode, review_policy, acceptance_criteria, workflow_version,
                 created_by, created_at, updated_at`,
      [task.id],
    )) as readonly TaskRow[];
    const completed = rows[0];
    if (!completed) throw new Error("Research task completion returned no row");

    await recordTaskEvent(
      tx,
      completed,
      "RESEARCH_TASK_COMPLETED",
      "research.task.completed",
      actor,
      {
        submissionId,
        completionKind: "unreviewed_acceptance",
      },
    );
    return toTask(completed);
  });
}
