import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../tests/integration/support/postgres";
import { runInReadOnlySnapshot } from "./transactions";

describe("runInReadOnlySnapshot", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await testDb.client.sql.unsafe(
      "create table read_snapshot_probe (id integer primary key, value text not null)",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("rejects writes inside the snapshot", async () => {
    await expect(
      runInReadOnlySnapshot(testDb.client.sql, async (tx) => {
        await tx.unsafe(
          "insert into read_snapshot_probe (id, value) values (1, 'forbidden')",
        );
      }),
    ).rejects.toThrow(/read.?only/i);
  });

  it("keeps repeatable reads stable while a concurrent write commits", async () => {
    await testDb.client.sql.unsafe(
      "insert into read_snapshot_probe (id, value) values (2, 'before') on conflict (id) do update set value = excluded.value",
    );

    const seen = await runInReadOnlySnapshot(testDb.client.sql, async (tx) => {
      const firstRows = await tx.unsafe(
        "select value from read_snapshot_probe where id = 2",
      );

      await testDb.client.sql.unsafe(
        "update read_snapshot_probe set value = 'after' where id = 2",
      );

      const secondRows = await tx.unsafe(
        "select value from read_snapshot_probe where id = 2",
      );

      return {
        first: String(firstRows[0]?.value),
        second: String(secondRows[0]?.value),
      };
    });

    expect(seen).toEqual({ first: "before", second: "before" });

    const outsideRows = await testDb.client.sql.unsafe(
      "select value from read_snapshot_probe where id = 2",
    );
    expect(String(outsideRows[0]?.value)).toBe("after");
  });

  it("times out connection acquisition and releases a late reservation", async () => {
    vi.useFakeTimers();
    try {
      let resolveReservation:
        | ((reserved: { unsafe: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) => void)
        | undefined;
      const release = vi.fn();
      const reserved = {
        unsafe: vi.fn(),
        release,
      };
      const reserve = vi.fn(
        () =>
          new Promise<typeof reserved>((resolve) => {
            resolveReservation = resolve;
          }),
      );
      const fakeSql = { reserve } as unknown as DatabaseSql;
      const work = vi.fn();

      const snapshot = runInReadOnlySnapshot(fakeSql, work);
      const rejected = expect(snapshot).rejects.toThrow(/timed out.*reserv/i);

      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;

      expect(work).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();

      resolveReservation?.(reserved);
      await Promise.resolve();
      await Promise.resolve();

      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
