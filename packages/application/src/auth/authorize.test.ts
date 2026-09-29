import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeProjectAccess } from "./authorize";
import { initializeFoundationDatabase } from "@research-workbench/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "../../../../tests/integration/support/postgres";

describe("project authorization", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe("insert into teams (id, name) values ('auth-team', 'Auth Team')");
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('auth-lead', 'auth-team', 'lead@auth.test', 'Lead', 'lead', 'human'), ('auth-member', 'auth-team', 'member@auth.test', 'Member', 'researcher', 'human'), ('auth-collab', 'auth-team', 'collab@auth.test', 'Collaborator', 'researcher', 'human'), ('auth-observer', 'auth-team', 'observer@auth.test', 'Observer', 'researcher', 'human'), ('auth-outsider', 'auth-team', 'outside@auth.test', 'Outside', 'researcher', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('auth-portfolio', 'auth-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('auth-project', 'auth-portfolio', 'Project', 'auth-member')",
    );
    await testDb.client.sql.unsafe(
      "insert into project_memberships (id, project_id, member_id, role) values ('auth-membership', 'auth-project', 'auth-member', 'lead'), ('auth-collab-membership', 'auth-project', 'auth-collab', 'collaborator'), ('auth-observer-membership', 'auth-project', 'auth-observer', 'observer')",
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("allows the team lead to read any team project", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-lead", "auth-project", "read"),
    ).resolves.toBeUndefined();
  });

  it("allows a project member to read their project", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-member", "auth-project", "read"),
    ).resolves.toBeUndefined();
  });

  it("keeps formal write restricted to team lead and project lead", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-lead", "auth-project", "write"),
    ).resolves.toBeUndefined();
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-member", "auth-project", "write"),
    ).resolves.toBeUndefined();
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-collab", "auth-project", "write"),
    ).rejects.toThrow(/forbidden/i);
  });

  it("allows collaborators to write files without widening formal write", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-lead", "auth-project", "file_write" as never),
    ).resolves.toBeUndefined();
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-member", "auth-project", "file_write" as never),
    ).resolves.toBeUndefined();
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-collab", "auth-project", "file_write" as never),
    ).resolves.toBeUndefined();
  });

  it("keeps observer-style roles read-only for files", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-observer", "auth-project", "file_write" as never),
    ).rejects.toThrow(/forbidden/i);
  });

  it("rejects a non-project member", async () => {
    await expect(
      authorizeProjectAccess(testDb.client.sql, "auth-outsider", "auth-project", "read"),
    ).rejects.toThrow(/forbidden/i);
  });
});
