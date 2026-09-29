import type { DatabaseSql } from "@research-workbench/db/src/client";

export type TransactionSql = Pick<DatabaseSql, "unsafe">;

export async function runInTransaction<T>(
  sql: DatabaseSql,
  work: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) =>
    work({ unsafe: tx.unsafe.bind(tx) } as TransactionSql),
  );
  return result as T;
}
