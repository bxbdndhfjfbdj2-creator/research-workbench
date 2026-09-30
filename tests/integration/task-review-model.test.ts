import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as researchTaskDomain from "../../packages/domain/src/research-task";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

async function applyMigrationFile(testDb: TestDatabase, name: string): Promise<void> {
  const sql = await readFile(resolve(process.cwd(), "packages/db/migrations", name), "utf8");
  for (const statement of sql
    .split("-- statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await testDb.client.sql.unsafe(statement);
  }
}

describe("phase 4B task/review model", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);
    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('review-team', 'Review Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values
        ('review-owner', 'review-team', 'owner@review.test', 'Owner', 'researcher', 'human'),
        ('reviewer', 'review-team', 'reviewer@review.test', 'Reviewer', 'researcher', 'human')`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('review-portfolio', 'review-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('review-project', 'review-portfolio', 'Project', 'review-owner')",
    );
    await testDb.client.sql.unsafe(
      `insert into project_memberships (id, project_id, member_id, role)
       values
        ('owner-membership', 'review-project', 'review-owner', 'lead'),
        ('reviewer-membership', 'review-project', 'reviewer', 'collaborator')`,
    );
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, created_by)
       values ('review-task', 'review-project', 'Review task', 'in_progress', 'review-owner', 'review-owner')`,
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("exports workflow-v2 research task constants", () => {
    expect((researchTaskDomain as Record<string, unknown>).RESEARCH_TASK_EXECUTION_MODES)
      .toEqual(["human", "agent", "hybrid"]);
    expect((researchTaskDomain as Record<string, unknown>).RESEARCH_TASK_REVIEW_POLICIES)
      .toEqual(["none", "required"]);
    expect(researchTaskDomain.RESEARCH_TASK_STATUSES).toContain("awaiting_review");
  });

  it("adds workflow-v2 task columns with legacy-safe defaults", async () => {
    const rows = await testDb.client.sql.unsafe(
      `select execution_mode, review_policy, acceptance_criteria, workflow_version
       from research_tasks
       where id = 'review-task'`,
    );
    expect(rows[0]).toMatchObject({
      execution_mode: "human",
      review_policy: "none",
      acceptance_criteria: [],
      workflow_version: 1,
    });
  });

  it("enforces task and review enum constraints", async () => {
    await expect(
      testDb.client.sql.unsafe(
        "update research_tasks set execution_mode = 'robot' where id = 'review-task'",
      ),
    ).rejects.toThrow();
    await expect(
      testDb.client.sql.unsafe(
        "update research_tasks set review_policy = 'sometimes' where id = 'review-task'",
      ),
    ).rejects.toThrow();

    await testDb.client.sql.unsafe(
      `insert into task_submissions
        (id, research_task_id, project_id, submission_number, summary,
         requirement_snapshot, requirement_snapshot_schema_version, submitted_by_member_id)
       values
        ('submission-1', 'review-task', 'review-project', 1, 'Formal delivery',
         '{}'::jsonb, 1, 'review-owner')`,
    );

    await expect(
      testDb.client.sql.unsafe(
        `insert into task_submission_refs
          (id, submission_id, ref_kind, ref_id, relation)
         values ('bad-ref-kind', 'submission-1', 'unknown', 'x', 'source')`,
      ),
    ).rejects.toThrow();
    await expect(
      testDb.client.sql.unsafe(
        `insert into task_submission_refs
          (id, submission_id, ref_kind, ref_id, relation)
         values ('bad-ref-relation', 'submission-1', 'agent_run', 'x', 'unknown')`,
      ),
    ).rejects.toThrow();
    await expect(
      testDb.client.sql.unsafe(
        `insert into review_requests
          (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
         values ('bad-review', 'review-project', 'submission-1', 'reviewer', 'unknown', 'review-owner')`,
      ),
    ).rejects.toThrow();
  });

  it("deduplicates submission provenance and one review per submission", async () => {
    await testDb.client.sql.unsafe(
      `insert into task_submission_contributors
        (id, submission_id, contributor_kind, contributor_ref)
       values ('contributor-1', 'submission-1', 'human_member', 'review-owner')`,
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into task_submission_contributors
          (id, submission_id, contributor_kind, contributor_ref)
         values ('contributor-2', 'submission-1', 'human_member', 'review-owner')`,
      ),
    ).rejects.toThrow();

    await testDb.client.sql.unsafe(
      `insert into task_submission_refs
        (id, submission_id, ref_kind, ref_id, relation)
       values ('ref-1', 'submission-1', 'agent_run', 'run-1', 'context')`,
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into task_submission_refs
          (id, submission_id, ref_kind, ref_id, relation)
         values ('ref-2', 'submission-1', 'agent_run', 'run-1', 'context')`,
      ),
    ).rejects.toThrow();

    await testDb.client.sql.unsafe(
      `insert into review_requests
        (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
       values ('review-1', 'review-project', 'submission-1', 'reviewer', 'pending', 'review-owner')`,
    );
    await expect(
      testDb.client.sql.unsafe(
        `insert into review_requests
          (id, project_id, task_submission_id, reviewer_member_id, status, created_by_member_id)
         values ('review-2', 'review-project', 'submission-1', 'reviewer', 'pending', 'review-owner')`,
      ),
    ).rejects.toThrow();
  });

  it("keeps formal submission and review history facts immutable", async () => {
    await testDb.client.sql.unsafe(
      `insert into review_actions
        (id, review_request_id, action, actor_type, actor_id, resulting_status)
       values ('action-1', 'review-1', 'assigned', 'human', 'review-owner', 'pending')`,
    );

    for (const [table, id] of [
      ["task_submissions", "submission-1"],
      ["task_submission_contributors", "contributor-1"],
      ["task_submission_refs", "ref-1"],
      ["review_actions", "action-1"],
    ] as const) {
      await expect(
        testDb.client.sql.unsafe(`delete from ${table} where id = $1`, [id]),
      ).rejects.toThrow(/append|immutable/i);
    }
  });
});

describe("phase 4B legacy migration", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await applyMigrationFile(testDb, "0000_foundation.sql");
    await applyMigrationFile(testDb, "0001_files_provenance.sql");

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('legacy-team', 'Legacy Team')",
    );
    await testDb.client.sql.unsafe(
      `insert into members
        (id, team_id, email, display_name, organization_role, actor_type)
       values ('legacy-owner', 'legacy-team', 'legacy@review.test', 'Legacy', 'researcher', 'human')`,
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('legacy-portfolio', 'legacy-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('legacy-project', 'legacy-portfolio', 'Legacy Project', 'legacy-owner')",
    );
    await testDb.client.sql.unsafe(
      `insert into research_tasks
        (id, project_id, title, status, assignee_member_id, created_by)
       values ('legacy-task', 'legacy-project', 'Legacy task', 'open', null, 'legacy-owner')`,
    );

    await applyMigrationFile(testDb, "0002_human_hybrid_work_review.sql");
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("backfills legacy ownership and workflow defaults without fabricating provenance", async () => {
    const taskRows = await testDb.client.sql.unsafe(
      `select assignee_member_id, execution_mode, review_policy,
              acceptance_criteria, workflow_version
       from research_tasks where id = 'legacy-task'`,
    );
    expect(taskRows[0]).toMatchObject({
      assignee_member_id: "legacy-owner",
      execution_mode: "human",
      review_policy: "none",
      acceptance_criteria: [],
      workflow_version: 1,
    });

    for (const table of ["task_submissions", "review_requests", "review_actions"]) {
      const rows = await testDb.client.sql.unsafe(
        `select count(*)::int as count from ${table}`,
      );
      expect(rows[0]?.count).toBe(0);
    }
  });
});
