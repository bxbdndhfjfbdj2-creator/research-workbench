import { randomUUID } from "node:crypto";
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
import { createScientificDecisionInTransaction } from "../decisions/create-decision";
import { appendResearchEvent } from "../events/append-research-event";
import { createResearchResultInTransaction } from "../results/create-result";
import { runInTransaction, type TransactionSql } from "../transactions";

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

async function persistRunArtifacts(
  tx: TransactionSql,
  runId: string,
  projectId: string,
  result: HarnessExecutionResult,
): Promise<void> {
  const rows: Array<{ kind: string; payload: JsonValue }> = [
    {
      kind: "visible_summary",
      payload: { summary: result.visibleMessageSummary },
    },
    ...result.toolFacts.map((fact) => ({
      kind: "tool_fact",
      payload: { tool: fact.tool, summary: fact.summary } as JsonValue,
    })),
    ...result.artifactRefs.map((ref) => ({
      kind: "artifact_ref",
      payload: { ref } as JsonValue,
    })),
    ...result.githubHints.map((hint) => ({
      kind: "github_hint",
      payload: { kind: hint.kind, value: hint.value } as JsonValue,
    })),
  ];

  for (const row of rows) {
    await tx.unsafe(
      `insert into agent_run_artifacts (id, run_id, kind, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [randomUUID(), runId, row.kind, JSON.stringify(row.payload)],
    );
  }
  await appendResearchEvent(tx, {
    id: randomUUID(),
    projectId,
    eventType: "AGENT_RUN_ARTIFACTS_RECORDED",
    actor: { type: "system", id: "agent-result-ingestion" },
    payload: { agentRunId: runId, count: rows.length },
  });
}

export async function ingestAgentResult(
  sql: DatabaseSql,
  runId: string,
  result: HarnessExecutionResult,
): Promise<AgentResultIngestion> {
  assertSecretSafe(result as unknown as JsonValue);
  if (result.stopReason !== "completed") {
    throw new Error("Agent result ingestion requires a completed Run");
  }

  return runInTransaction(sql, async (tx) => {
    const priorRows = await tx.unsafe(
      `select research_result_id, decision_ids
       from agent_run_ingestions
       where run_id = $1
       limit 1`,
      [runId],
    );
    const prior = priorRows[0];
    if (prior) {
      return {
        researchResultId: prior.research_result_id
          ? String(prior.research_result_id)
          : null,
        decisionIds: Array.isArray(prior.decision_ids)
          ? prior.decision_ids.map(String)
          : [],
      };
    }

    const rows = (await tx.unsafe(
      `select r.project_id, r.state, s.data_version_ref
       from agent_runs r
       left join agent_context_snapshots s on s.id = r.context_snapshot_id
       where r.id = $1
       for update`,
      [runId],
    )) as readonly RunContext[];
    const run = rows[0];
    if (!run) throw new Error("Agent run not found");
    if (!["已派发", "执行中", "完成"].includes(run.state)) {
      throw new Error("Agent result ingestion requires a completed Run");
    }

    if (result.researchResult) validateResearchResult(result.researchResult, run);
    const decisions = result.scientificChangeProposals.map((proposal) =>
      decisionFrom(run.project_id, proposal),
    );
    const agentActor = { type: "agent" as const, id: `agent-run:${runId}` };

    await persistRunArtifacts(tx, runId, run.project_id, result);

    let researchResultId: string | null = null;
    if (result.researchResult) {
      const created = await createResearchResultInTransaction(
        tx,
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
      const decision = await createScientificDecisionInTransaction(
        tx,
        proposal,
        agentActor,
      );
      decisionIds.push(decision.id);
    }

    await tx.unsafe(
      `insert into agent_run_ingestions
        (run_id, research_result_id, decision_ids)
       values ($1, $2, $3::jsonb)`,
      [runId, researchResultId, JSON.stringify(decisionIds)],
    );

    await tx.unsafe(
      `update agent_runs
       set state = '完成', failure_code = null, updated_at = now()
       where id = $1`,
      [runId],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: run.project_id,
      eventType: "AGENT_RUN_COMPLETED",
      actor: { type: "system", id: "agent-result-ingestion" },
      payload: {
        agentRunId: runId,
        researchResultId,
        decisionIds,
      },
    });

    return { researchResultId, decisionIds };
  });
}
