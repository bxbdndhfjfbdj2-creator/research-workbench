import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

const PROJECT_ID = "github-project";
const MEMBER_ID = "github-lead";
const FULL_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function seedProject(testDb: TestDatabase): Promise<void> {
  await testDb.client.sql`
    insert into teams (id, name)
    values ('github-team', 'GitHub Team')
  `;
  await testDb.client.sql`
    insert into members
      (id, team_id, email, display_name, organization_role, actor_type)
    values
      (${MEMBER_ID}, 'github-team', 'github-lead@example.com', 'GitHub Lead', 'lead', 'human')
  `;
  await testDb.client.sql`
    insert into research_portfolios (id, team_id, name)
    values ('github-portfolio', 'github-team', 'GitHub Portfolio')
  `;
  await testDb.client.sql`
    insert into research_projects (id, portfolio_id, title, lead_member_id)
    values (${PROJECT_ID}, 'github-portfolio', 'GitHub Project', ${MEMBER_ID})
  `;
}

async function insertBinding(testDb: TestDatabase, suffix: string): Promise<string> {
  const installationId = `installation-${suffix}`;
  const bindingId = `binding-${suffix}`;
  await testDb.client.sql.unsafe(
    `insert into github_installations
      (id, github_installation_id, account_id, account_login, status, last_observed_at)
     values ($1, $2, $3, $4, 'active', now())`,
    [installationId, `gh-installation-${suffix}`, `account-${suffix}`, `fixture-${suffix}`],
  );
  await testDb.client.sql.unsafe(
    `insert into project_github_repository_bindings
      (id, project_id, installation_id, repository_id, repository_full_name,
       status, created_by_member_id)
     values ($1, $2, $3, $4, $5, 'active', $6)`,
    [
      bindingId,
      PROJECT_ID,
      installationId,
      `repo-${suffix}`,
      `fixture/${suffix}`,
      MEMBER_ID,
    ],
  );
  return bindingId;
}

describe("GitHub engineering truth schema", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await seedProject(testDb);
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("exports the canonical Phase 5 domain enums", async () => {
    const domain = await import("../../packages/domain/src/github-engineering");

    expect([...domain.ENGINEERING_VERIFICATION_STATES]).toEqual([
      "unverified",
      "awaiting_pr",
      "pending_ci",
      "verified",
      "failed",
      "unknown",
    ]);
    expect([...domain.GITHUB_REFERENCE_TYPES]).toEqual([
      "issue",
      "branch",
      "commit",
      "pull_request",
      "review",
      "workflow_run",
    ]);
    expect([...domain.ENGINEERING_VERIFICATION_REASON_CODES]).toEqual(
      expect.arrayContaining([
        "repository_not_bound",
        "commit_not_found",
        "no_qualifying_pull_request",
        "pull_request_not_merged",
        "required_checks_not_configured",
        "required_check_missing",
        "required_check_failed",
        "required_check_cancelled",
        "required_check_timed_out",
        "required_check_skipped",
        "required_check_neutral",
        "required_check_action_required",
        "required_check_stale",
        "required_check_conflict",
        "github_unavailable",
        "github_rate_limited",
        "github_auth_unavailable",
        "unsupported_merge_queue",
      ]),
    );
  });

  it("creates the Phase 5 GitHub engineering tables", async () => {
    const rows = (await testDb.client.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `) as Array<{ table_name: string }>;
    const tables = new Set(rows.map((row) => row.table_name));

    for (const expected of [
      "github_installations",
      "project_github_repository_bindings",
      "github_verification_policy_revisions",
      "github_verification_policy_required_checks",
      "engineering_verification_targets",
      "github_references",
      "research_result_engineering_targets",
      "agent_run_engineering_targets",
      "research_task_engineering_targets",
      "research_result_github_references",
      "agent_run_github_references",
      "research_task_github_references",
      "engineering_verifications",
    ]) {
      expect(tables.has(expected), expected).toBe(true);
    }
  });

  it("deduplicates verification targets and confirmed GitHub references", async () => {
    const bindingId = await insertBinding(testDb, "dedupe");

    await testDb.client.sql.unsafe(
      `insert into engineering_verification_targets
        (id, project_id, claimed_repository_full_name, commit_sha)
       values ('target-dedupe-1', $1, 'fixture/dedupe', $2)`,
      [PROJECT_ID, FULL_SHA],
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into engineering_verification_targets
          (id, project_id, claimed_repository_full_name, commit_sha)
         values ('target-dedupe-2', $1, 'fixture/dedupe', $2)`,
        [PROJECT_ID, FULL_SHA],
      ),
    ).rejects.toThrow();

    await testDb.client.sql.unsafe(
      `insert into github_references
        (id, project_id, repository_binding_id, type, external_id, url)
       values ('reference-dedupe-1', $1, $2, 'commit', $3, $4)`,
      [PROJECT_ID, bindingId, FULL_SHA, `https://github.com/fixture/dedupe/commit/${FULL_SHA}`],
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into github_references
          (id, project_id, repository_binding_id, type, external_id, url)
         values ('reference-dedupe-2', $1, $2, 'commit', $3, $4)`,
        [PROJECT_ID, bindingId, FULL_SHA, `https://github.com/fixture/dedupe/commit/${FULL_SHA}`],
      ),
    ).rejects.toThrow();
  });

  it("uses real subject foreign keys for target and confirmed-reference links", async () => {
    const bindingId = await insertBinding(testDb, "subject-fk");
    await testDb.client.sql.unsafe(
      `insert into engineering_verification_targets
        (id, project_id, claimed_repository_full_name, commit_sha)
       values ('target-subject-fk', $1, 'fixture/subject-fk', $2)`,
      [PROJECT_ID, FULL_SHA],
    );
    await testDb.client.sql.unsafe(
      `insert into github_references
        (id, project_id, repository_binding_id, type, external_id, url)
       values ('reference-subject-fk', $1, $2, 'commit', $3, $4)`,
      [PROJECT_ID, bindingId, FULL_SHA, `https://github.com/fixture/subject-fk/commit/${FULL_SHA}`],
    );

    for (const [table, subjectColumn] of [
      ["research_result_engineering_targets", "research_result_id"],
      ["agent_run_engineering_targets", "agent_run_id"],
      ["research_task_engineering_targets", "research_task_id"],
    ] as const) {
      await expect(
        testDb.client.sql.unsafe(
          `insert into ${table} (id, ${subjectColumn}, target_id)
           values ($1, 'missing-subject', 'target-subject-fk')`,
          [`${table}-orphan`],
        ),
      ).rejects.toThrow();
    }

    for (const [table, subjectColumn] of [
      ["research_result_github_references", "research_result_id"],
      ["agent_run_github_references", "agent_run_id"],
      ["research_task_github_references", "research_task_id"],
    ] as const) {
      await expect(
        testDb.client.sql.unsafe(
          `insert into ${table} (id, ${subjectColumn}, github_reference_id)
           values ($1, 'missing-subject', 'reference-subject-fk')`,
          [`${table}-orphan`],
        ),
      ).rejects.toThrow();
    }
  });

  it("keeps verification policy revisions append-only and referenced bindings retire-only", async () => {
    const bindingId = await insertBinding(testDb, "policy");

    await testDb.client.sql.unsafe(
      `insert into github_verification_policy_revisions
        (id, repository_binding_id, verification_branch, created_by_member_id)
       values ('policy-revision-1', $1, 'main', $2)`,
      [bindingId, MEMBER_ID],
    );
    await testDb.client.sql.unsafe(
      `insert into github_verification_policy_required_checks
        (id, policy_revision_id, context, integration_id, workflow_id, accepted_events)
       values
        ('policy-check-1', 'policy-revision-1', 'quality', 'github-actions', 'CI', '["pull_request"]'::jsonb)`,
    );

    await expect(
      testDb.client.sql.unsafe(
        `update github_verification_policy_revisions
         set verification_branch = 'release'
         where id = 'policy-revision-1'`,
      ),
    ).rejects.toThrow(/append|immutable/i);
    await expect(
      testDb.client.sql.unsafe(
        `delete from github_verification_policy_revisions
         where id = 'policy-revision-1'`,
      ),
    ).rejects.toThrow(/append|immutable/i);
    await expect(
      testDb.client.sql.unsafe(
        `update github_verification_policy_required_checks
         set context = 'other'
         where id = 'policy-check-1'`,
      ),
    ).rejects.toThrow(/append|immutable/i);

    await testDb.client.sql.unsafe(
      `update project_github_repository_bindings
       set status = 'retired', retired_at = now()
       where id = $1`,
      [bindingId],
    );
    const retired = await testDb.client.sql.unsafe(
      `select status from project_github_repository_bindings where id = $1`,
      [bindingId],
    );
    expect(retired[0]?.status).toBe("retired");
    await expect(
      testDb.client.sql.unsafe(
        `delete from project_github_repository_bindings where id = $1`,
        [bindingId],
      ),
    ).rejects.toThrow();
  });

  it("constrains verification state and reason and keeps one verification per target", async () => {
    await testDb.client.sql.unsafe(
      `insert into engineering_verification_targets
        (id, project_id, claimed_repository_full_name, commit_sha)
       values
        ('target-state-valid', $1, 'fixture/state', $2),
        ('target-state-invalid', $1, 'fixture/state', $3),
        ('target-reason-invalid', $1, 'fixture/state', $4)`,
      [
        PROJECT_ID,
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "cccccccccccccccccccccccccccccccccccccccc",
        "dddddddddddddddddddddddddddddddddddddddd",
      ],
    );

    await testDb.client.sql.unsafe(
      `insert into engineering_verifications
        (id, target_id, state, reason_code)
       values
        ('verification-valid', 'target-state-valid', 'unverified', 'repository_not_bound')`,
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into engineering_verifications
          (id, target_id, state, reason_code)
         values
          ('verification-duplicate', 'target-state-valid', 'unverified', 'repository_not_bound')`,
      ),
    ).rejects.toThrow();
    await expect(
      testDb.client.sql.unsafe(
        `insert into engineering_verifications
          (id, target_id, state)
         values
          ('verification-invalid-state', 'target-state-invalid', 'projection_test_unknown')`,
      ),
    ).rejects.toThrow();
    await expect(
      testDb.client.sql.unsafe(
        `insert into engineering_verifications
          (id, target_id, state, reason_code)
         values
          ('verification-invalid-reason', 'target-reason-invalid', 'failed', 'projection_test_unknown')`,
      ),
    ).rejects.toThrow();
  });
});
