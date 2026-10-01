import type { DatabaseSql } from "@research-workbench/db/src/client";

export type TransactionSql = Pick<DatabaseSql, "unsafe">;

const READ_ONLY_SNAPSHOT_RESERVE_TIMEOUT_MS = 5_000;

async function reserveWithTimeout(sql: DatabaseSql) {
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const reservation = sql.reserve().then((reserved) => {
    if (timedOut) {
      reserved.release();
    }
    return reserved;
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error("Timed out reserving database connection for read-only snapshot"));
    }, READ_ONLY_SNAPSHOT_RESERVE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([reservation, timeoutPromise]);
  } finally {
    if (!timedOut && timeout) clearTimeout(timeout);
  }
}

export async function runInTransaction<T>(
  sql: DatabaseSql,
  work: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) =>
    work({ unsafe: tx.unsafe.bind(tx) } as TransactionSql),
  );
  return result as T;
}

export async function runInReadOnlySnapshot<T>(
  sql: DatabaseSql,
  work: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const reserved = await reserveWithTimeout(sql);
  let transactionStarted = false;

  try {
    await reserved.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;

    const result = await work({
      unsafe: reserved.unsafe.bind(reserved),
    } as TransactionSql);

    await reserved.unsafe("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await reserved.unsafe("ROLLBACK");
      } catch {
        // Preserve the original projection/query error.
      }
    }
    throw error;
  } finally {
    reserved.release();
  }
}
