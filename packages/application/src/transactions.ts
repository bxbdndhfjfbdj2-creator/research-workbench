import type { Sql } from "postgres";

export type TransactionSql = Sql;

export async function runInTransaction<T>(
  _sql: Sql,
  _work: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  throw new Error("runInTransaction not implemented");
}
