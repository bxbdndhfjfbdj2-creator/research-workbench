import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  createFileOutboxHandler as createApplicationFileOutboxHandler,
  type FileProcessingDependencies,
} from "../../../packages/application/src/files/process-upload";

export function createFileOutboxHandler(
  sql: DatabaseSql,
  deps: FileProcessingDependencies,
) {
  return createApplicationFileOutboxHandler(sql, deps);
}
