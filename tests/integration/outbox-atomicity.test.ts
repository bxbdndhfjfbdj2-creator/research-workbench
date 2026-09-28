import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendResearchEvent } from "../../packages/application/src/events/append-research-event";
import { enqueueOutbox } from "../../packages/application/src/outbox/enqueue-outbox";
import { runInTransaction } from "../../packages/application/src/transactions";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("research event and outbox atomicity", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('team-atomic', 'Atomic Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('lead-atomic', 'team-atomic', 'lead@atomic.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('portfolio-atomic', 'team-atomic', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('project-atomic', 'portfolio-atomic', 'Project', 'lead-atomic')",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("rolls back state, event, and outbox together", async () => {
    await expect(
      runInTransaction(testDb.client.sql, async (tx) => {
        await tx.unsafe(
          "insert into research_dimension_states (id, project_id, dimension, state, updated_by) values ('state-rollback', 'project-atomic', 'data', 'candidate', 'lead-atomic')",
        );
        await appendResearchEvent(tx, {
          id: "event-rollback",
          projectId: "project-atomic",
          eventType: "RESEARCH_STATE_CHANGED",
          actor: { type: "human", id: "lead-atomic" },
          payload: { dimension: "data", state: "candidate" },
        });
        await enqueueOutbox(tx, {
          id: "outbox-rollback",
          eventType: "project.state.changed",
          payload: { projectId: "project-atomic" },
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const [stateCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_dimension_states where id = 'state-rollback'",
    );
    const [eventCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where id = 'event-rollback'",
    );
    const [outboxCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from outbox_events where id = 'outbox-rollback'",
    );

    expect(stateCount?.count).toBe(0);
    expect(eventCount?.count).toBe(0);
    expect(outboxCount?.count).toBe(0);
  });

  it("commits state, event, and outbox together", async () => {
    await runInTransaction(testDb.client.sql, async (tx) => {
      await tx.unsafe(
        "insert into research_dimension_states (id, project_id, dimension, state, updated_by) values ('state-commit', 'project-atomic', 'theory', 'exploring', 'lead-atomic')",
      );
      await appendResearchEvent(tx, {
        id: "event-commit",
        projectId: "project-atomic",
        eventType: "RESEARCH_STATE_CHANGED",
        actor: { type: "human", id: "lead-atomic" },
        payload: { dimension: "theory", state: "exploring" },
      });
      await enqueueOutbox(tx, {
        id: "outbox-commit",
        eventType: "project.state.changed",
        payload: { projectId: "project-atomic" },
      });
    });

    const [stateCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_dimension_states where id = 'state-commit'",
    );
    const [eventCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where id = 'event-commit'",
    );
    const [outboxCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from outbox_events where id = 'outbox-commit'",
    );

    expect(stateCount?.count).toBe(1);
    expect(eventCount?.count).toBe(1);
    expect(outboxCount?.count).toBe(1);
  });

  it("rejects secret-shaped event payloads without persisting them", async () => {
    await expect(
      runInTransaction(testDb.client.sql, async (tx) =>
        appendResearchEvent(tx, {
          id: "event-secret",
          projectId: "project-atomic",
          eventType: "BAD_EVENT",
          actor: { type: "human", id: "lead-atomic" },
          payload: { token: "should-not-be-recorded" },
        }),
      ),
    ).rejects.toThrow();

    const [eventCount] = await testDb.client.sql.unsafe(
      "select count(*)::int as count from research_events where id = 'event-secret'",
    );
    expect(eventCount?.count).toBe(0);
  });
});
