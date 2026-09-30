import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initializeFoundationDatabase,
  researchEventRepository,
} from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("foundation database", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("creates the foundational research tables", async () => {
    const rows = (await testDb.client.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `) as Array<{ table_name: string }>;
    const tables = new Set(rows.map((row) => row.table_name));

    for (const expected of [
      "teams",
      "members",
      "research_portfolios",
      "research_projects",
      "project_memberships",
      "research_dimension_states",
      "research_events",
      "outbox_events",
      "integration_inbox",
      "task_submissions",
      "task_submission_contributors",
      "task_submission_refs",
      "review_requests",
      "review_actions",
      "review_decision_links",
    ]) {
      expect(tables.has(expected), expected).toBe(true);
    }
  });

  it("enforces member email uniqueness within a team", async () => {
    await testDb.client.sql`insert into teams (id, name) values ('team-1', 'Team One')`;
    await testDb.client.sql`
      insert into members (id, team_id, email, display_name, organization_role, actor_type)
      values ('member-1', 'team-1', 'person@example.com', 'Person', 'researcher', 'human')
    `;

    await expect(
      testDb.client.sql`
        insert into members (id, team_id, email, display_name, organization_role, actor_type)
        values ('member-2', 'team-1', 'person@example.com', 'Other', 'researcher', 'human')
      `,
    ).rejects.toThrow();
  });

  it("deduplicates external events by provider and external id", async () => {
    await testDb.client.sql`
      insert into integration_inbox (id, provider, external_id, payload)
      values ('inbox-1', 'github', 'delivery-1', '{}'::jsonb)
    `;

    await expect(
      testDb.client.sql`
        insert into integration_inbox (id, provider, external_id, payload)
        values ('inbox-2', 'github', 'delivery-1', '{}'::jsonb)
      `,
    ).rejects.toThrow();
  });

  it("does not expose update or delete methods for research events", () => {
    expect(Object.keys(researchEventRepository).sort()).toEqual(["listByProject"]);
  });

  it("enforces research events as append-only at the database boundary", async () => {
    await testDb.client.sql`
      insert into research_events (id, project_id, event_type, actor_type, actor_id, payload)
      values ('immutable-event', null, 'TEST_EVENT', 'system', 'test-suite', '{}'::jsonb)
    `;

    await expect(
      testDb.client.sql`
        update research_events set event_type = 'MUTATED_EVENT' where id = 'immutable-event'
      `,
    ).rejects.toThrow(/append|immutable/i);

    await expect(
      testDb.client.sql`
        delete from research_events where id = 'immutable-event'
      `,
    ).rejects.toThrow(/append|immutable/i);
  });
});
