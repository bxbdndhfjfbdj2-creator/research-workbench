"use server";

import { revalidatePath } from "next/cache";
import {
  assignResearchTaskOwner,
  blockResearchTask,
  cancelResearchTask,
  completeUnreviewedTask,
  createResearchTask,
  reopenResearchTask,
  setResearchTaskExecutionMode,
  setResearchTaskReviewPolicy,
  startResearchTask,
  unblockResearchTask,
  updateResearchTaskRequirements,
} from "@research-workbench/application/src/tasks/research-task-service";
import { submitResearchTask } from "@research-workbench/application/src/tasks/task-submission-service";
import {
  approveSubmission,
  reassignReviewer,
  rejectSubmission,
  requestSubmissionChanges,
} from "@research-workbench/application/src/tasks/task-review-service";
import { escalateReviewToScientificDecision } from "@research-workbench/application/src/tasks/task-review-escalation";
import {
  RESEARCH_TASK_EXECUTION_MODES,
  RESEARCH_TASK_REVIEW_POLICIES,
  type ResearchTaskExecutionMode,
  type ResearchTaskReviewPolicy,
} from "@research-workbench/domain/src/research-task";
import {
  TASK_SUBMISSION_REF_KINDS,
  TASK_SUBMISSION_REF_RELATIONS,
  type TaskSubmissionRefKind,
  type TaskSubmissionRefRelation,
} from "@research-workbench/domain/src/task-review";
import {
  DECISION_LEVELS,
  OFFICIAL_REVISION_SLOTS,
  type DecisionLevel,
  type DecisionProposal,
  type OfficialRevisionSlot,
} from "@research-workbench/domain/src/scientific-decision";
import { getWebDbClient, requireCurrentMember } from "./queries";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4_000;
const CRITERION_MAX = 1_000;
const CRITERIA_MAX = 20;
const SUBMISSION_SUMMARY_MAX = 8_000;
const REVIEW_COMMENT_MAX = 4_000;
const DECISION_TITLE_MAX = 200;
const DECISION_REASON_MAX = 4_000;

function requiredText(
  formData: FormData,
  name: string,
  maxLength?: number,
): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  if (maxLength && value.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return value;
}

function optionalText(
  formData: FormData,
  name: string,
  maxLength?: number,
): string | null {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) return null;
  if (maxLength && value.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return value;
}

function parseAcceptanceCriteria(formData: FormData): string[] {
  const raw = String(formData.get("acceptanceCriteria") ?? "");
  const criteria = raw
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (criteria.length > CRITERIA_MAX) {
    throw new Error(`acceptance criteria are limited to ${CRITERIA_MAX} entries`);
  }
  for (const criterion of criteria) {
    if (criterion.length > CRITERION_MAX) {
      throw new Error(
        `acceptance criterion must be at most ${CRITERION_MAX} characters`,
      );
    }
  }
  return criteria;
}

function parseExecutionMode(formData: FormData): ResearchTaskExecutionMode {
  const value = requiredText(formData, "executionMode");
  if (!RESEARCH_TASK_EXECUTION_MODES.includes(value as ResearchTaskExecutionMode)) {
    throw new Error("Invalid execution mode");
  }
  return value as ResearchTaskExecutionMode;
}

function parseReviewPolicy(formData: FormData): ResearchTaskReviewPolicy {
  const value = requiredText(formData, "reviewPolicy");
  if (!RESEARCH_TASK_REVIEW_POLICIES.includes(value as ResearchTaskReviewPolicy)) {
    throw new Error("Invalid review policy");
  }
  return value as ResearchTaskReviewPolicy;
}

function parseSubmissionRef(
  formData: FormData,
): {
  kind: TaskSubmissionRefKind;
  refId: string;
  relation: TaskSubmissionRefRelation;
} | null {
  const kindText = optionalText(formData, "refKind");
  const refId = optionalText(formData, "refId");
  const relationText = optionalText(formData, "refRelation");
  if (!kindText && !refId && !relationText) return null;
  if (!kindText || !refId || !relationText) {
    throw new Error("Submission ref kind, id and relation must be provided together");
  }
  if (!TASK_SUBMISSION_REF_KINDS.includes(kindText as TaskSubmissionRefKind)) {
    throw new Error("Invalid submission ref kind");
  }
  if (
    !TASK_SUBMISSION_REF_RELATIONS.includes(
      relationText as TaskSubmissionRefRelation,
    )
  ) {
    throw new Error("Invalid submission ref relation");
  }
  return {
    kind: kindText as TaskSubmissionRefKind,
    refId,
    relation: relationText as TaskSubmissionRefRelation,
  };
}

function parseDecisionLevel(formData: FormData): DecisionLevel {
  const value = requiredText(formData, "decisionLevel");
  if (!DECISION_LEVELS.includes(value as DecisionLevel)) {
    throw new Error("Invalid scientific decision level");
  }
  return value as DecisionLevel;
}

function parseDecisionChange(
  formData: FormData,
): DecisionProposal["change"] {
  const kind = requiredText(formData, "changeKind");
  if (kind === "record_only") return { kind: "record_only" };
  if (kind !== "official_revision") {
    throw new Error("Invalid scientific decision change kind");
  }
  const slot = requiredText(formData, "officialSlot");
  if (!OFFICIAL_REVISION_SLOTS.includes(slot as OfficialRevisionSlot)) {
    throw new Error("Invalid official revision slot");
  }
  return {
    kind: "official_revision",
    slot: slot as OfficialRevisionSlot,
    revisionId: requiredText(formData, "revisionId"),
  };
}

async function safeMutation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new Error("Research work action failed");
  }
}

function revalidateResearchWork(projectId: string, taskId?: string): void {
  revalidatePath("/reviews");
  revalidatePath(`/projects/${projectId}/work`);
  if (taskId) revalidatePath(`/projects/${projectId}/work/${taskId}`);
}

async function actor() {
  const member = await requireCurrentMember();
  return {
    member,
    ref: { type: "human" as const, id: member.id },
    sql: getWebDbClient().sql,
  };
}

export async function createResearchTaskAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const title = requiredText(formData, "title", TITLE_MAX);
  const description = optionalText(formData, "description", DESCRIPTION_MAX);
  const executionMode = parseExecutionMode(formData);
  const reviewPolicy = parseReviewPolicy(formData);
  const acceptanceCriteria = parseAcceptanceCriteria(formData);
  const assigneeMemberId = optionalText(formData, "assigneeMemberId");
  const current = await actor();

  await safeMutation(() =>
    createResearchTask(
      current.sql,
      projectId,
      {
        title,
        description,
        executionMode,
        reviewPolicy,
        acceptanceCriteria,
        ...(assigneeMemberId ? { assigneeMemberId } : {}),
      },
      current.ref,
    ),
  );
  revalidateResearchWork(projectId);
}

export async function startResearchTaskAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const current = await actor();
  await safeMutation(() => startResearchTask(current.sql, taskId, current.ref));
  revalidateResearchWork(projectId, taskId);
}

export async function updateResearchTaskRequirementsAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const title = requiredText(formData, "title", TITLE_MAX);
  const description = optionalText(formData, "description", DESCRIPTION_MAX);
  const acceptanceCriteria = parseAcceptanceCriteria(formData);
  const current = await actor();
  await safeMutation(() =>
    updateResearchTaskRequirements(
      current.sql,
      taskId,
      { title, description, acceptanceCriteria },
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function setResearchTaskReviewPolicyAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewPolicy = parseReviewPolicy(formData);
  const current = await actor();
  await safeMutation(() =>
    setResearchTaskReviewPolicy(
      current.sql,
      taskId,
      reviewPolicy,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function assignResearchTaskOwnerAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const memberId = requiredText(formData, "memberId");
  const current = await actor();
  await safeMutation(() =>
    assignResearchTaskOwner(current.sql, taskId, memberId, current.ref),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function setResearchTaskExecutionModeAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const executionMode = parseExecutionMode(formData);
  const current = await actor();
  await safeMutation(() =>
    setResearchTaskExecutionMode(
      current.sql,
      taskId,
      executionMode,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function blockResearchTaskAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const current = await actor();
  await safeMutation(() => blockResearchTask(current.sql, taskId, current.ref));
  revalidateResearchWork(projectId, taskId);
}

export async function unblockResearchTaskAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const current = await actor();
  await safeMutation(() => unblockResearchTask(current.sql, taskId, current.ref));
  revalidateResearchWork(projectId, taskId);
}

export async function cancelResearchTaskAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const current = await actor();
  await safeMutation(() => cancelResearchTask(current.sql, taskId, current.ref));
  revalidateResearchWork(projectId, taskId);
}

export async function reopenResearchTaskAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const current = await actor();
  await safeMutation(() => reopenResearchTask(current.sql, taskId, current.ref));
  revalidateResearchWork(projectId, taskId);
}

export async function completeUnreviewedTaskAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const submissionId = requiredText(formData, "submissionId");
  const current = await actor();
  await safeMutation(() =>
    completeUnreviewedTask(
      current.sql,
      taskId,
      submissionId,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function submitResearchTaskAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const summary = requiredText(formData, "summary", SUBMISSION_SUMMARY_MAX);
  const reviewerMemberId = optionalText(formData, "reviewerMemberId");
  const agentRunContributorId = optionalText(
    formData,
    "agentRunContributorId",
  );
  const ref = parseSubmissionRef(formData);
  const current = await actor();

  await safeMutation(() =>
    submitResearchTask(
      current.sql,
      taskId,
      {
        summary,
        reviewerMemberId,
        contributors: agentRunContributorId
          ? [{ kind: "agent_run", runId: agentRunContributorId }]
          : [],
        refs: ref ? [ref] : [],
      },
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function reassignReviewerAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewRequestId = requiredText(formData, "reviewRequestId");
  const reviewerMemberId = requiredText(formData, "reviewerMemberId");
  const current = await actor();
  await safeMutation(() =>
    reassignReviewer(
      current.sql,
      reviewRequestId,
      reviewerMemberId,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function approveReviewAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewRequestId = requiredText(formData, "reviewRequestId");
  const comment = optionalText(formData, "comment", REVIEW_COMMENT_MAX);
  const current = await actor();
  await safeMutation(() =>
    approveSubmission(
      current.sql,
      reviewRequestId,
      comment,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function requestReviewChangesAction(
  formData: FormData,
): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewRequestId = requiredText(formData, "reviewRequestId");
  const comment = requiredText(formData, "comment", REVIEW_COMMENT_MAX);
  const current = await actor();
  await safeMutation(() =>
    requestSubmissionChanges(
      current.sql,
      reviewRequestId,
      comment,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function rejectReviewAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewRequestId = requiredText(formData, "reviewRequestId");
  const comment = requiredText(formData, "comment", REVIEW_COMMENT_MAX);
  const current = await actor();
  await safeMutation(() =>
    rejectSubmission(
      current.sql,
      reviewRequestId,
      comment,
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}

export async function escalateReviewAction(formData: FormData): Promise<void> {
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const reviewRequestId = requiredText(formData, "reviewRequestId");
  const level = parseDecisionLevel(formData);
  const title = requiredText(formData, "decisionTitle", DECISION_TITLE_MAX);
  const reason = requiredText(formData, "decisionReason", DECISION_REASON_MAX);
  const change = parseDecisionChange(formData);
  const current = await actor();

  await safeMutation(() =>
    escalateReviewToScientificDecision(
      current.sql,
      reviewRequestId,
      {
        level,
        title,
        reason,
        evidence: [],
        impact: [],
        change,
      },
      current.ref,
    ),
  );
  revalidateResearchWork(projectId, taskId);
}
