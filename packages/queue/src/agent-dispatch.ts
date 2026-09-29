import type { DatabaseSql } from "@research-workbench/db/src/client";
import type {
  AgentContextSnapshot,
  AgentRunState,
} from "@research-workbench/domain/src/agent-runtime";
import type { JsonValue } from "@research-workbench/domain/src/events";
import type { HarnessAdapter } from "../../harness-adapter/src/adapter";
import type {
  HarnessExecutionHandle,
  HarnessExecutionRequest,
} from "../../harness-adapter/src/types";
import { markRunState } from "../../application/src/agents/run-lifecycle";
import { ingestAgentResult } from "../../application/src/agents/result-ingestion";

const DISPATCH_ACTOR = { type: "system" as const, id: "agent-dispatcher" };

type DispatchRow = {
  run_id: string;
  project_id: string;
  research_task_id: string;
  agent_task_id: string;
  request: Record<string, JsonValue>;
  context_snapshot_id: string;
  research_question_revision_id: string | null;
  theory_revision_id: string | null;
  research_design_revision_id: string | null;
  data_version_ref: string | null;
  asset_version_refs: string[];
  git_base_commit: string | null;
  skill_version_refs: string[];
  harness_version: string;
  harness_profile: string;
  runtime_profile: string;
  model_route: string;
  sandbox_policy: AgentContextSnapshot["sandboxPolicy"];
  tool_allowlist: string[];
  subagent_allowlist: string[];
  execution_metadata: JsonValue | null;
  snapshot_created_by_type: AgentContextSnapshot["createdBy"]["type"];
  snapshot_created_by_id: string;
  snapshot_created_at: Date;
};

function taskString(
  request: Record<string, JsonValue>,
  key: string,
): string | null {
  const value = request[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function loadExecutionRequest(
  sql: DatabaseSql,
  runId: string,
): Promise<HarnessExecutionRequest> {
  const rows = (await sql.unsafe(
    `select
       r.id as run_id,
       r.project_id,
       at.research_task_id,
       at.id as agent_task_id,
       at.request,
       s.id as context_snapshot_id,
       s.research_question_revision_id,
       s.theory_revision_id,
       s.research_design_revision_id,
       s.data_version_ref,
       s.asset_version_refs,
       s.git_base_commit,
       s.skill_version_refs,
       s.harness_version,
       s.harness_profile,
       s.runtime_profile,
       s.model_route,
       s.sandbox_policy,
       s.tool_allowlist,
       s.subagent_allowlist,
       s.execution_metadata,
       s.created_by_type as snapshot_created_by_type,
       s.created_by_id as snapshot_created_by_id,
       s.created_at as snapshot_created_at
     from agent_runs r
     join agent_tasks at on at.id = r.agent_task_id
     join agent_context_snapshots s on s.id = r.context_snapshot_id
     where r.id = $1
     limit 1`,
    [runId],
  )) as readonly DispatchRow[];
  const row = rows[0];
  if (!row) throw new Error("Queued AgentRun is missing its execution context");

  const snapshot: AgentContextSnapshot = {
    id: row.context_snapshot_id,
    projectId: row.project_id,
    researchQuestionRevisionId: row.research_question_revision_id,
    theoryRevisionId: row.theory_revision_id,
    researchDesignRevisionId: row.research_design_revision_id,
    dataVersionRef: row.data_version_ref,
    assetVersionRefs: row.asset_version_refs,
    gitBaseCommit: row.git_base_commit,
    skillVersionRefs: row.skill_version_refs,
    harnessVersion: row.harness_version,
    harnessProfile: row.harness_profile,
    runtimeProfile: row.runtime_profile,
    modelRoute: row.model_route,
    sandboxPolicy: row.sandbox_policy,
    toolAllowlist: row.tool_allowlist,
    subagentAllowlist: row.subagent_allowlist,
    executionMetadata: row.execution_metadata ?? undefined,
    createdBy: {
      type: row.snapshot_created_by_type,
      id: row.snapshot_created_by_id,
    },
    createdAt: row.snapshot_created_at,
  };

  const outputSchema = row.request.outputSchema ?? {
    type: "object",
  };

  return {
    projectId: row.project_id,
    researchTaskId: row.research_task_id,
    agentTaskId: row.agent_task_id,
    runId: row.run_id,
    taskRequest: row.request,
    snapshot,
    cwd: taskString(row.request, "cwd") ?? `/workspace/${row.project_id}`,
    toolAllowlist: snapshot.toolAllowlist,
    subagentAllowlist: snapshot.subagentAllowlist,
    sandboxPolicy: snapshot.sandboxPolicy,
    outputSchema,
  };
}

function stateForHandle(handle: HarnessExecutionHandle): AgentRunState {
  switch (handle.state) {
    case "running":
      return "执行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "waiting_human":
      return "等待人工输入";
    case "cancelled":
      return "取消";
  }
}

export async function dispatchAgentRun(
  sql: DatabaseSql,
  adapter: HarnessAdapter,
  runId: string,
): Promise<void> {
  const claimed = await markRunState(sql, runId, "排队", "已派发", {
    actor: DISPATCH_ACTOR,
  });
  if (!claimed) {
    const rows = await sql.unsafe(
      "select state from agent_runs where id = $1 limit 1",
      [runId],
    );
    if (rows.length === 0) throw new Error("Agent run not found");
    return;
  }

  const health = await adapter.health();
  if (health.status !== "available") {
    await markRunState(sql, runId, "已派发", "排队", {
      actor: DISPATCH_ACTOR,
      failureCode: "HARNESS_UNAVAILABLE",
    });
    throw new Error(`Harness unavailable: ${health.detail ?? "no detail"}`);
  }

  const request = await loadExecutionRequest(sql, runId);
  let handle: HarnessExecutionHandle;
  try {
    handle = await adapter.start(request);
  } catch (error) {
    await markRunState(sql, runId, "已派发", "排队", {
      actor: DISPATCH_ACTOR,
      failureCode: "HARNESS_START_FAILED",
    });
    throw error;
  }

  if (handle.runId !== runId) {
    await markRunState(sql, runId, "已派发", "排队", {
      actor: DISPATCH_ACTOR,
      failureCode: "HARNESS_RUN_ID_MISMATCH",
    });
    throw new Error("Harness returned a mismatched run id");
  }

  const nextState = stateForHandle(handle);
  if (nextState === "完成") {
    if (!handle.result) {
      await markRunState(sql, runId, "已派发", "失败", {
        actor: DISPATCH_ACTOR,
        failureCode: "INVALID_AGENT_OUTPUT",
      });
      throw new Error("Completed Harness execution returned no structured result");
    }
    try {
      await ingestAgentResult(sql, runId, handle.result);
    } catch (error) {
      await markRunState(sql, runId, "已派发", "失败", {
        actor: DISPATCH_ACTOR,
        failureCode: "INVALID_AGENT_OUTPUT",
      });
      throw error;
    }
    return;
  }

  const changed = await markRunState(sql, runId, "已派发", nextState, {
    actor: DISPATCH_ACTOR,
    failureCode: nextState === "失败" ? "HARNESS_EXECUTION_FAILED" : null,
  });
  if (!changed) {
    throw new Error("Agent run state changed while Harness execution was being recorded");
  }
}
