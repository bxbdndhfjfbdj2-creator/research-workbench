import type {
  AgentContextSnapshot,
  AgentSandboxPolicy,
} from "../../domain/src/agent-runtime";
import type { JsonValue } from "../../domain/src/events";

export type HarnessStopReason =
  | "completed"
  | "failed"
  | "waiting_human"
  | "cancelled";

export type HarnessExecutionState =
  | "running"
  | "completed"
  | "failed"
  | "waiting_human"
  | "cancelled";

export type HarnessExecutionRequest = {
  projectId: string;
  researchTaskId: string;
  agentTaskId: string;
  runId: string;
  snapshot: AgentContextSnapshot;
  cwd: string;
  toolAllowlist: string[];
  subagentAllowlist: string[];
  sandboxPolicy: AgentSandboxPolicy;
  outputSchema: JsonValue;
  envAllowlist?: string[];
};

export type HarnessResumeRequest = {
  runId: string;
  sessionId: string;
  resumePayload: JsonValue;
};

export type HarnessToolFact = {
  tool: string;
  summary: string;
};

export type HarnessGitHubHint = {
  kind: string;
  value: string;
};

export type HarnessScientificChangeProposal = {
  title: string;
  reason: string;
  evidence?: JsonValue;
  impact?: string[];
  change?: JsonValue;
};

export type HarnessExecutionResult = {
  visibleMessageSummary: string;
  toolFacts: HarnessToolFact[];
  artifactRefs: string[];
  githubHints: HarnessGitHubHint[];
  scientificChangeProposals: HarnessScientificChangeProposal[];
  stopReason: HarnessStopReason;
};

export type HarnessExecutionHandle = {
  runId: string;
  sessionId: string;
  state: HarnessExecutionState;
  result?: HarnessExecutionResult;
};

export type HarnessHealth = {
  status: "available" | "unavailable";
  detail?: string;
};

export type FakeHarnessScriptStep = Omit<HarnessExecutionHandle, "runId">;
