import type { ActorRef } from "@research-workbench/domain/src/actor";
import type { TransactionSql } from "../transactions";
import { applyApprovedOfficialRevisionChange } from "../research-graph/official-revision";

export async function applyApprovedDecision(
  tx: TransactionSql,
  decisionId: string,
  actor: ActorRef,
): Promise<void> {
  const rows = await tx.unsafe(
    "select change_kind from scientific_decisions where id = $1 limit 1",
    [decisionId],
  );
  const kind = rows[0]?.change_kind;
  if (!kind) throw new Error("Scientific decision not found");
  if (kind === "record_only") return;
  if (kind === "official_revision") {
    await applyApprovedOfficialRevisionChange(tx, decisionId, actor);
    return;
  }
  throw new Error(`Unsupported scientific decision change kind: ${String(kind)}`);
}
