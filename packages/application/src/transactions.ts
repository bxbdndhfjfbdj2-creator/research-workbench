import type { Sql } from "postgres";

export type TransactionSql = Pick<Sql, "unsafe">;

export async function runInTransaction<T>(
  sql: Sql,
  work: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => work(tx as unknown as TransactionSql));
  return result as T;
}
