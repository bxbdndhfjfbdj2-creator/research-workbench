import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { JsonValue } from "@research-workbench/domain/src/events";
import { assertSecretSafe } from "@research-workbench/domain/src/events";
import {
  OFFICIAL_REVISION_SLOTS,
  type DecisionChange,
  type DecisionEvidence,
  type DecisionProposal,
} from "@research-workbench/domain/src/scientific-decision";
import type { AgentResearchResultOutput } from "@research-workbench/domain/src/agent-output";
import type { HarnessExecutionResult } from "../../../harness-adapter/src/types";
import { createScientificDecision } from "../decisions/create-decision";
import { createResearchResult } from "../results/create-result";

export type AgentResultIngestion = {
  researchResultId: string | null;
  decisionIds: string[];
};

type RunContext = {
  project_id: string;
  state: string;
  data_version_ref: string | null;
};

function validateResearchResult(
  output: AgentResearchResultOutput,
  run: RunContext,
): void {
  if (!output.dataVersionRef.trim()) {
    throw new Error("Agent research result requires a data version reference");
  }
  if (!output.analysisRevisionId.trim()) {
    throw new Error("Agent research result requires an analysis revision");
  }
  if (!Array.isArray(output.outputRefs) || output.outputRefs.some((ref) => !ref.trim())) {
    throw new Error("Agent research result output references are invalid");
  }
  if (run.data_version_ref && output.dataVersionRef !== run.data_version_ref) {
    throw new Error("Agent result data version differs from the frozen context snapshot");
  }
  if (output.executionKind === "code" && !output.gitCommit) {
    throw new Error("Code Agent research results require an immutable Git commit locator");
  }
}

function evidenceFrom(value: JsonValue | undefined): DecisionEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Scientific proposal evidence must be an array");
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.kind !== "string" ||
      typeof item.ref !== "string"
    ) {
      throw new Error("Scientific proposal evidence is malformed");
    }
    return { kind: item.kind, ref: item.ref };
  });
}

function changeFrom(value: JsonValue | undefined): DecisionChange {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.kind !== "string"
  ) {
    return { kind: "record_only" };
  }
  if (value.kind === "record_only") return { kind: "record_only" };
  if (
    value.kind === "official_revision" &&
    typeof value.slot === "string" &&
    (OFFICIAL_REVISION_SLOTS as readonly string[]).includes(value.slot) &&
    typeof value.revisionId === "string" &&
    value.revisionId.trim()
  ) {
    return {
      kind: "official_revision",
      slot: value.slot as (typeof OFFICIAL_REVISION_SLOTS)[number],
      revisionId: value.revisionId,
    };
  }
  throw new Error("Scientific proposal change is malformed");
}

function decisionFrom(
  projectId: string,
  proposal: HarnessExecutionResult["scientificChangeProposals"][number],
): DecisionProposal {
  if (!proposal.title.trim() || !proposal.reason.trim()) {
    throw new Error("Scientific proposal requires a title and reason");
  }
  const change = changeFrom(proposal.change);
  return {
    projectId,
    level: change.kind === "official_revision" ? "major" : "general",
    title: proposal.title,
    reason: proposal.reason,
    evidence: evidenceFrom(proposal.evidence),
    impact: proposal.impact ?? [],
    change,
  };
}

export async function ingestAgentResult(
  sql: DatabaseSql,
  runId: string,
  result: HarnessExecutionResult,
): Promise<AgentResultIngestion> {
  assertSecretSafe(result as unknown as JsonValue);

  const rows = (await sql.unsafe(
    `select r.project_id, r.state, s.data_version_ref
     from agent_runs r
     left join agent_context_snapshots s on s.id = r.context_snapshot_id
     where r.id = $1
     limit 1`,
    [runId],
  )) as readonly RunContext[];
  const run = rows[0];
  if (!run) throw new Error("Agent run not found");
  if (run.state !== "完成" || result.stopReason !== "completed") {
    throw new Error("Agent result ingestion requires a completed Run");
  }

  if (result.researchResult) validateResearchResult(result.researchResult, run);
  const decisions = result.scientificChangeProposals.map((proposal) =>
    decisionFrom(run.project_id, proposal),
  );

  const agentActor = { type: "agent" as const, id: `agent-run:${runId}` };
  let researchResultId: string | null = null;
  if (result.researchResult) {
    const created = await createResearchResult(
      sql,
      {
        projectId: run.project_id,
        dataVersionRef: result.researchResult.dataVersionRef,
        analysisRevisionId: result.researchResult.analysisRevisionId,
        executionKind: result.researchResult.executionKind,
        runRef: runId,
        outputRefs: result.researchResult.outputRefs,
        ...(result.researchResult.gitCommit
          ? { gitCommit: result.researchResult.gitCommit }
          : {}),
      },
      agentActor,
    );
    researchResultId = created.id;
  }

  const decisionIds: string[] = [];
  for (const proposal of decisions) {
    const decision = await createScientificDecision(sql, proposal, agentActor);
    decisionIds.push(decision.id);
  }

  return { researchResultId, decisionIds };
}
