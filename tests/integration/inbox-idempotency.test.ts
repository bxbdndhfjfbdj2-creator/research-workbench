import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptExternalEvent } from "../../packages/queue/src/inbox";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("integration inbox idempotency", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("accepts the same external event exactly once under concurrent delivery", async () => {
    const results = await Promise.all([
      acceptExternalEvent(testDb.client.sql, "github", "delivery-42", { kind: "push" }),
      acceptExternalEvent(testDb.client.sql, "github", "delivery-42", { kind: "push" }),
      acceptExternalEvent(testDb.client.sql, "github", "delivery-42", { kind: "push" }),
    ]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.inboxId)).size).toBe(1);

    const rows = await testDb.client.sql.unsafe(
      "select count(*)::int as count from integration_inbox where provider = 'github' and external_id = 'delivery-42'",
    );
    expect(rows[0]?.count).toBe(1);
  });
});
