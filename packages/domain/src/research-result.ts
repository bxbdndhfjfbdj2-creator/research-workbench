import type { ActorRef } from "./actor";

export type GitCommitLocator = {
  repositoryFullName: string;
  sha: string;
};

export type ResearchResultExecutionKind = "manual" | "code";

export type CreateResearchResultInput = {
  projectId: string;
  dataVersionRef: string;
  analysisRevisionId: string;
  executionKind: ResearchResultExecutionKind;
  runRef: string;
  outputRefs: string[];
  gitCommit?: GitCommitLocator;
};

export type ResearchResult = CreateResearchResultInput & {
  id: string;
  createdBy: ActorRef;
  createdAt: Date;
};
