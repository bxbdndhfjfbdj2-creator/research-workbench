export type AgentResearchResultOutput = {
  dataVersionRef: string;
  analysisRevisionId: string;
  executionKind: "manual" | "code";
  outputRefs: string[];
  gitCommit?: {
    repositoryFullName: string;
    sha: string;
  };
};
