import type { AgentRunState } from "@research-workbench/domain/src/agent-runtime";
import type {
  ResearchDimension,
  ResearchDimensionStateValue,
} from "@research-workbench/domain/src/research-dimensions";
import type {
  FileAccessClass,
  FileParseStatus,
} from "@research-workbench/domain/src/research-file";
import type { ResearchTaskStatus } from "@research-workbench/domain/src/research-task";
import type { DecisionStatus } from "@research-workbench/domain/src/scientific-decision";
import type { ReviewRequestStatus } from "@research-workbench/domain/src/task-review";
import type { DecisionReviewStage } from "../decisions/review-eligibility";

export type CockpitViewer = {
  memberId: string;
  teamId: string;
  organizationRole: "lead" | "researcher";
};

export const ATTENTION_KINDS = [
  "my_review",
  "my_scientific_decision",
  "blocked_task",
  "awaiting_scientific_decision",
  "agent_waiting_human",
  "agent_run_failed",
  "file_parse_failed",
  "long_idle_work",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type CurrentReviewFact = {
  id: string;
  status: ReviewRequestStatus;
  reviewerMemberId: string;
  submissionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  linkedDecisionId: string | null;
};

export type ResearchTaskCurrentFact = {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  status: ResearchTaskStatus;
  ownerMemberId: string;
  ownerDisplayName: string;
  updatedAt: Date;
  latestSubmissionAt: Date | null;
  latestReviewAt: Date | null;
  latestLinkedDecisionAt: Date | null;
  latestAgentRunAt: Date | null;
  currentReview: CurrentReviewFact | null;
};

export type ScientificDecisionCurrentFact = {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  status: DecisionStatus;
  updatedAt: Date;
  reviewStage: DecisionReviewStage | null;
};

export type AgentRunCurrentFact = {
  id: string;
  agentTaskId: string;
  researchTaskId: string;
  projectId: string;
  projectTitle: string;
  taskTitle: string;
  attemptNumber: number;
  state: AgentRunState;
  updatedAt: Date;
};

export type FileParseFailureCurrentFact = {
  researchFileId: string;
  fileVersionId: string;
  projectId: string;
  projectTitle: string;
  fileTitle: string;
  versionNumber: number;
  accessClass: FileAccessClass;
  parseStatus: FileParseStatus;
  failedAt: Date;
};

export type ProjectAttentionFacts = {
  now: Date;
  viewer: CockpitViewer;
  tasks: ResearchTaskCurrentFact[];
  decisions: ScientificDecisionCurrentFact[];
  agentRuns: AgentRunCurrentFact[];
  fileParseFailures: FileParseFailureCurrentFact[];
};

export type AttentionBase = {
  kind: AttentionKind;
  id: string;
  projectId: string;
  projectTitle: string;
  occurredOrWaitingSince: Date;
  href: string;
};

export type MyReviewAttention = AttentionBase & {
  kind: "my_review";
  taskId: string;
  taskTitle: string;
  reviewRequestId: string;
  submissionNumber: number;
};

export type MyScientificDecisionAttention = AttentionBase & {
  kind: "my_scientific_decision";
  decisionId: string;
  decisionTitle: string;
  reviewStage: DecisionReviewStage;
};

export type BlockedTaskAttention = AttentionBase & {
  kind: "blocked_task";
  taskId: string;
  taskTitle: string;
  ownerMemberId: string;
  ownerDisplayName: string;
};

export type AwaitingScientificDecisionAttention = AttentionBase & {
  kind: "awaiting_scientific_decision";
  taskId: string;
  taskTitle: string;
  reviewRequestId: string;
  scientificDecisionId: string | null;
};

export type AgentWaitingHumanAttention = AttentionBase & {
  kind: "agent_waiting_human";
  researchTaskId: string;
  taskTitle: string;
  agentTaskId: string;
  agentRunId: string;
  attemptNumber: number;
};

export type AgentRunFailedAttention = AttentionBase & {
  kind: "agent_run_failed";
  researchTaskId: string;
  taskTitle: string;
  agentTaskId: string;
  agentRunId: string;
  attemptNumber: number;
};

export type FileParseFailedAttention = AttentionBase & {
  kind: "file_parse_failed";
  researchFileId: string;
  fileVersionId: string;
  fileTitle: string;
  versionNumber: number;
  accessClass: FileAccessClass;
};

export type LongIdleWorkAttention = AttentionBase & {
  kind: "long_idle_work";
  taskId: string;
  taskTitle: string;
  lastMeaningfulActivityAt: Date;
  daysIdle: number;
};

export type CockpitAttentionItem =
  | MyReviewAttention
  | MyScientificDecisionAttention
  | BlockedTaskAttention
  | AwaitingScientificDecisionAttention
  | AgentWaitingHumanAttention
  | AgentRunFailedAttention
  | FileParseFailedAttention
  | LongIdleWorkAttention;

export const COCKPIT_ACTIVITY_KINDS = [
  "task_submission_created",
  "task_status_changed",
  "review_changed",
  "scientific_decision_changed",
  "research_state_changed",
  "research_result_created",
  "research_result_superseded",
  "agent_run_changed",
  "research_file_created",
  "file_version_created",
  "file_parse_failed",
  "file_scan_rejected",
] as const;

export type CockpitActivityKind = (typeof COCKPIT_ACTIVITY_KINDS)[number];

export type CockpitActivityItem = {
  kind: CockpitActivityKind;
  id: string;
  projectId: string;
  projectTitle: string;
  occurredAt: Date;
  label: string;
  href: string;
};

export type SafeProjectSummary = {
  id: string;
  title: string;
  leadMemberId: string;
  leadName: string;
  dimensions: Array<{
    dimension: ResearchDimension;
    state: ResearchDimensionStateValue;
  }>;
};

export type CockpitLaneSummary = {
  kind: AttentionKind;
  totalCount: number;
  preview: CockpitAttentionItem[];
};

export type ProjectCurrentFacts = {
  project: SafeProjectSummary;
  tasks: ResearchTaskCurrentFact[];
  decisions: ScientificDecisionCurrentFact[];
  agentRuns: AgentRunCurrentFact[];
  fileParseFailures: FileParseFailureCurrentFact[];
};

export type ProjectCockpitSummary = {
  project: SafeProjectSummary;
  lanes: CockpitLaneSummary[];
  latestActivityAt: Date | null;
};

export type ProjectCockpit = {
  generatedAt: Date;
  project: SafeProjectSummary;
  explicitActions: CockpitAttentionItem[];
  attention: CockpitAttentionItem[];
  recentActivity: CockpitActivityItem[];
};

export type PortfolioCockpit = {
  generatedAt: Date;
  myActions: CockpitAttentionItem[];
  projects: ProjectCockpitSummary[];
  recentActivity: CockpitActivityItem[];
};
