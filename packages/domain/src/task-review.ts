import type {
  ResearchTaskExecutionMode,
  ResearchTaskReviewPolicy,
} from "./research-task";

export const TASK_SUBMISSION_CONTRIBUTOR_KINDS = [
  "human_member",
  "agent_run",
] as const;
export type TaskSubmissionContributorKind =
  (typeof TASK_SUBMISSION_CONTRIBUTOR_KINDS)[number];

export const TASK_SUBMISSION_REF_KINDS = [
  "file_version",
  "research_result",
  "research_node_revision",
  "agent_run",
] as const;
export type TaskSubmissionRefKind = (typeof TASK_SUBMISSION_REF_KINDS)[number];

export const TASK_SUBMISSION_REF_RELATIONS = [
  "deliverable",
  "evidence",
  "source",
  "context",
] as const;
export type TaskSubmissionRefRelation =
  (typeof TASK_SUBMISSION_REF_RELATIONS)[number];

export const REVIEW_REQUEST_STATUSES = [
  "pending",
  "awaiting_scientific_decision",
  "approved",
  "changes_requested",
  "rejected",
  "cancelled",
] as const;
export type ReviewRequestStatus = (typeof REVIEW_REQUEST_STATUSES)[number];

export const REVIEW_ACTION_KINDS = [
  "assigned",
  "reassigned",
  "approve",
  "request_changes",
  "reject",
  "cancel",
  "escalate_to_scientific_decision",
  "scientific_decision_resolved",
] as const;
export type ReviewActionKind = (typeof REVIEW_ACTION_KINDS)[number];

export type TaskRequirementSnapshot = {
  title: string;
  description: string | null;
  acceptanceCriteria: string[];
  executionMode: ResearchTaskExecutionMode;
  reviewPolicy: ResearchTaskReviewPolicy;
};

export type TaskSubmission = {
  id: string;
  researchTaskId: string;
  projectId: string;
  submissionNumber: number;
  summary: string;
  requirementSnapshot: TaskRequirementSnapshot;
  requirementSnapshotSchemaVersion: number;
  submittedByMemberId: string;
  createdAt: Date;
};

export type ReviewRequest = {
  id: string;
  projectId: string;
  taskSubmissionId: string;
  reviewerMemberId: string;
  status: ReviewRequestStatus;
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
};
