export const RESEARCH_TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "awaiting_review",
  "completed",
  "cancelled",
] as const;

export type ResearchTaskStatus = (typeof RESEARCH_TASK_STATUSES)[number];

export const RESEARCH_TASK_EXECUTION_MODES = [
  "human",
  "agent",
  "hybrid",
] as const;

export type ResearchTaskExecutionMode =
  (typeof RESEARCH_TASK_EXECUTION_MODES)[number];

export const RESEARCH_TASK_REVIEW_POLICIES = [
  "none",
  "required",
] as const;

export type ResearchTaskReviewPolicy =
  (typeof RESEARCH_TASK_REVIEW_POLICIES)[number];

export type ResearchTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ResearchTaskStatus;
  assigneeMemberId: string;
  executionMode: ResearchTaskExecutionMode;
  reviewPolicy: ResearchTaskReviewPolicy;
  acceptanceCriteria: string[];
  workflowVersion: 1 | 2;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
