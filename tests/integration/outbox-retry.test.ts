import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimOutboxBatch,
  markOutboxDelivered,
} from "../../packages/queue/src/outbox-dispatcher";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("outbox retry after worker crash", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("reclaims an abandoned delivery and executes it once after restart", async () => {
    await testDb.client.sql.unsafe(
      "insert into outbox_events (id, event_type, payload) values ('retry-outbox', 'test.event', '{}'::jsonb)",
    );

    const firstClaim = await claimOutboxBatch(testDb.client.sql, 1);
    expect(firstClaim.map((row) => row.id)).toEqual(["retry-outbox"]);

    // Simulate a process crash after claim and before dispatch/ack.
    await testDb.client.sql.unsafe(
      "update outbox_events set claimed_at = now() - interval '2 minutes' where id = 'retry-outbox'",
    );

    const restartedClaim = await claimOutboxBatch(testDb.client.sql, 1);
    const deliveries: string[] = [];
    for (const record of restartedClaim) {
      deliveries.push(record.id);
      await markOutboxDelivered(testDb.client.sql, record.id);
    }

    expect(deliveries).toEqual(["retry-outbox"]);
    expect(await claimOutboxBatch(testDb.client.sql, 1)).toEqual([]);

    const rows = await testDb.client.sql.unsafe(
      "select status from outbox_events where id = 'retry-outbox'",
    );
    expect(rows[0]?.status).toBe("delivered");
  });

  it("does not let two workers claim the same pending row", async () => {
    await testDb.client.sql.unsafe(
      "insert into outbox_events (id, event_type, payload) values ('race-outbox', 'test.event', '{}'::jsonb)",
    );

    const [left, right] = await Promise.all([
      claimOutboxBatch(testDb.client.sql, 1),
      claimOutboxBatch(testDb.client.sql, 1),
    ]);

    expect([...left, ...right].filter((row) => row.id === "race-outbox")).toHaveLength(1);
  });
});
