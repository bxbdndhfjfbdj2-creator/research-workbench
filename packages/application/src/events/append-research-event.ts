import type { ResearchEventInput, ResearchEventRecord } from "@research-workbench/domain/src/events";
import type { TransactionSql } from "../transactions";

export async function appendResearchEvent(
  _tx: TransactionSql,
  _event: ResearchEventInput,
): Promise<ResearchEventRecord> {
  throw new Error("appendResearchEvent not implemented");
}
