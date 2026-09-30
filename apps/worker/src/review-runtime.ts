import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ClaimedOutboxRecord } from "@research-workbench/queue/src/outbox-dispatcher";
import { resumeReviewAfterScientificDecision } from "../../../packages/application/src/tasks/task-review-escalation";
import type { BooleanOutboxHandler } from "./file-runtime";

function readDecisionId(record: ClaimedOutboxRecord): string {
  const payload = record.payload;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.decisionId !== "string" ||
    !payload.decisionId.trim()
  ) {
    throw new Error("scientific.decision.reviewed payload requires decisionId");
  }
  return payload.decisionId;
}

export function createReviewResolutionOutboxHandler(
  sql: DatabaseSql,
): BooleanOutboxHandler {
  return async (record) => {
    if (record.eventType !== "scientific.decision.reviewed") {
      return false;
    }

    // Re-read the decision in the application service. The outbox payload status
    // is informational only and cannot make a non-terminal decision terminal.
    await resumeReviewAfterScientificDecision(sql, readDecisionId(record));
    return true;
  };
}
