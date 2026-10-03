import type {
  EngineeringVerificationReasonCode,
  EngineeringVerificationState,
  GitHubVerificationAcceptedEvent,
} from "@research-workbench/domain/src/github-engineering";

export type GitHubPullRequestFact = {
  externalId: string;
  headSha: string;
  baseBranch: string;
  merged: boolean;
  mergedAt: string | null;
};

export type RequiredCheckPolicy = {
  context: string;
  integrationId: string | null;
  workflowId: string | null;
  acceptedEvents: GitHubVerificationAcceptedEvent[];
};

export type GitHubVerificationPolicyFact = {
  revisionId: string;
  verificationBranch: string;
  requiredChecks: RequiredCheckPolicy[];
};

export type GitHubCheckObservation = {
  context: string;
  sourceType: "check_run" | "commit_status";
  integrationId: string | null;
  workflowId: string | null;
  workflowEvent: GitHubVerificationAcceptedEvent | null;
  executionId: string;
  attemptNumber: number | null;
  status: string;
  conclusion: string | null;
};

export type EngineeringVerificationInput = {
  repositoryBound: boolean;
  commitExists: boolean;
  targetSha: string;
  pullRequests: GitHubPullRequestFact[];
  policy: GitHubVerificationPolicyFact;
  checks: GitHubCheckObservation[];
};

export type EngineeringVerificationDecision = {
  state: EngineeringVerificationState;
  reasonCode: EngineeringVerificationReasonCode | null;
  selectedPullRequestExternalId: string | null;
  evidenceExecutionIds: string[];
};
