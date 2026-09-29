import type { ActorRef } from "./actor";
import type { JsonValue } from "./events";

export const AGENT_RUN_STATES = [
  "已提议",
  "等待授权",
  "排队",
  "已派发",
  "执行中",
  "等待人工输入",
  "继续执行",
  "完成",
  "失败",
  "取消",
  "被替代",
] as const;

export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

export const AGENT_SANDBOX_POLICIES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type AgentSandboxPolicy = (typeof AGENT_SANDBOX_POLICIES)[number];

export type AgentExecutionPolicy = {
  sandboxPolicy: AgentSandboxPolicy;
  toolAllowlist: string[];
  subagentAllowlist: string[];
  runtimeProfile: string;
  harnessVersion: string;
  harnessProfile: string;
  modelRoute: string;
  skillVersionRefs: string[];
  gitBaseCommit: string | null;
};

export type AgentTaskRequest = Record<string, JsonValue>;

export type AgentTask = {
  id: string;
  researchTaskId: string;
  projectId: string;
  request: AgentTaskRequest;
  createdBy: ActorRef;
  createdAt: Date;
};

export type AgentContextSnapshotInput = AgentExecutionPolicy & {
  researchQuestionRevisionId: string | null;
  theoryRevisionId: string | null;
  researchDesignRevisionId: string | null;
  dataVersionRef: string | null;
  assetVersionRefs: string[];
  executionMetadata?: JsonValue;
};

export type AgentContextSnapshot = AgentContextSnapshotInput & {
  id: string;
  projectId: string;
  createdBy: ActorRef;
  createdAt: Date;
};

export type CreateAgentRunPolicy = AgentExecutionPolicy & {
  contextSnapshotId: string | null;
};

export type AgentRun = {
  id: string;
  agentTaskId: string;
  projectId: string;
  attemptNumber: number;
  contextSnapshotId: string | null;
  state: AgentRunState;
  executionPolicy: AgentExecutionPolicy;
  failureCode: string | null;
  createdBy: ActorRef;
  createdAt: Date;
  updatedAt: Date;
};

export type HarnessSessionReference = {
  id: string;
  runId: string;
  sessionId: string;
  runtimeProfile: string;
  harnessVersion: string;
  generation: number;
  createdAt: Date;
};
