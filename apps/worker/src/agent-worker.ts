import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ClaimedOutboxRecord } from "@research-workbench/queue/src/outbox-dispatcher";
import { dispatchAgentRun } from "@research-workbench/queue/src/agent-dispatch";
import type { HarnessAdapter } from "../../../packages/harness-adapter/src/adapter";

export function createAgentOutboxHandler(
  sql: DatabaseSql,
  adapter: HarnessAdapter,
) {
  return async (record: ClaimedOutboxRecord): Promise<boolean> => {
    if (record.eventType !== "agent.run.dispatch") return false;
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
      throw new Error("Invalid agent.run.dispatch payload");
    }
    const runId = record.payload.agentRunId;
    if (typeof runId !== "string" || !runId) {
      throw new Error("agent.run.dispatch requires agentRunId");
    }
    await dispatchAgentRun(sql, adapter, runId);
    return true;
  };
}
