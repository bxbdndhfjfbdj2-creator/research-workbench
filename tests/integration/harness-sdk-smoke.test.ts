import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { initializeFoundationDatabase } from "../../packages/db/src/client";
import {
  getCurrentHarnessSessionReference,
  recordHarnessSessionReference,
} from "../../packages/application/src/agents/harness-session-reference";
import { SdkHarnessAdapter } from "../../packages/harness-adapter/src/sdk-adapter";
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from "./support/postgres";

describe("Harness SDK integration boundary", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    await initializeFoundationDatabase(testDb.client.sql);

    await testDb.client.sql.unsafe(
      "insert into teams (id, name) values ('harness-sdk-team', 'Harness SDK Team')",
    );
    await testDb.client.sql.unsafe(
      "insert into members (id, team_id, email, display_name, organization_role, actor_type) values ('harness-sdk-lead', 'harness-sdk-team', 'lead@harness-sdk.test', 'Lead', 'lead', 'human')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_portfolios (id, team_id, name) values ('harness-sdk-portfolio', 'harness-sdk-team', 'Portfolio')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_projects (id, portfolio_id, title, lead_member_id) values ('harness-sdk-project', 'harness-sdk-portfolio', 'Harness SDK Project', 'harness-sdk-lead')",
    );
    await testDb.client.sql.unsafe(
      "insert into research_tasks (id, project_id, title, status, created_by) values ('harness-sdk-research-task', 'harness-sdk-project', 'SDK smoke', 'open', 'harness-sdk-lead')",
    );
    await testDb.client.sql.unsafe(
      `insert into agent_tasks
        (id, research_task_id, project_id, request, created_by_type, created_by_id)
       values
        ('harness-sdk-agent-task', 'harness-sdk-research-task', 'harness-sdk-project',
         '{"objective":"sdk smoke"}'::jsonb, 'human', 'harness-sdk-lead')`,
    );
    await testDb.client.sql.unsafe(
      `insert into agent_context_snapshots
        (id, project_id, asset_version_refs, skill_version_refs, harness_version,
         harness_profile, runtime_profile, model_route, sandbox_policy,
         tool_allowlist, subagent_allowlist, created_by_type, created_by_id)
       values
        ('harness-sdk-snapshot', 'harness-sdk-project', '[]'::jsonb, '[]'::jsonb,
         '4878cdabd87d4041bdaff61d04c966883b9fd07a', 'sdk',
         'research-execution', 'deepseek-official/deepseek-v4-flash',
         'read-only', '["read_file"]'::jsonb, '[]'::jsonb,
         'human', 'harness-sdk-lead')`,
    );
    await testDb.client.sql.unsafe(
      `insert into agent_runs
        (id, agent_task_id, project_id, attempt_number, context_snapshot_id,
         state, execution_policy, created_by_type, created_by_id)
       values
        ('harness-sdk-run', 'harness-sdk-agent-task', 'harness-sdk-project', 1,
         'harness-sdk-snapshot', '已派发',
         '{"sandboxPolicy":"read-only","toolAllowlist":["read_file"],"subagentAllowlist":[],"runtimeProfile":"research-execution","harnessVersion":"4878cdabd87d4041bdaff61d04c966883b9fd07a","harnessProfile":"sdk","modelRoute":"deepseek-official/deepseek-v4-flash","skillVersionRefs":[],"gitBaseCommit":null}'::jsonb,
         'human', 'harness-sdk-lead')`,
    );
  }, 120_000);

  afterAll(async () => {
    if (testDb) await stopTestDatabase(testDb);
  });

  it("keeps append-only generations when a run reconnects to Harness", async () => {
    const first = await recordHarnessSessionReference(
      testDb.client.sql,
      "harness-sdk-run",
      "rw-harness-sdk-run",
      {
        runtimeProfile: "research-execution",
        harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      },
    );
    const second = await recordHarnessSessionReference(
      testDb.client.sql,
      "harness-sdk-run",
      "rw-harness-sdk-run",
      {
        runtimeProfile: "research-execution",
        harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      },
    );

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
    expect((await getCurrentHarnessSessionReference(
      testDb.client.sql,
      "harness-sdk-run",
    ))?.generation).toBe(2);

    const rows = await testDb.client.sql.unsafe(
      "select generation from harness_session_references where run_id = $1 order by generation",
      ["harness-sdk-run"],
    );
    expect(rows.map((row) => row.generation)).toEqual([1, 2]);
  });

  const hasRealHarness = Boolean(
    process.env.DEEPSEEK_API_KEY && process.env.RW_DSH_BIN,
  );
  const realHarnessIt = hasRealHarness ? it : it.skip;

  realHarnessIt(
    "runs a real pinned DeepSeek Harness SDK turn when runtime credentials are configured",
    async () => {
      const recorded: string[] = [];
      const adapter = new SdkHarnessAdapter({
        dshBin: process.env.RW_DSH_BIN!,
        dshHome:
          process.env.RW_DSH_HOME ??
          resolve(process.cwd(), ".tmp/harness-sdk-smoke-home"),
        profile: "sdk",
        patchPaths: [
          resolve(process.cwd(), "infra/harness/workbench.cordis.yml"),
        ],
        provider: process.env.RW_DSH_PROVIDER ?? "deepseek-official",
        model: process.env.RW_DSH_MODEL ?? "deepseek-v4-flash",
        pinnedHarnessVersion:
          "4878cdabd87d4041bdaff61d04c966883b9fd07a",
        allowedEnvironmentNames: ["PATH", "HOME", "DEEPSEEK_API_KEY"],
        async recordSessionReference(reference) {
          recorded.push(reference.sessionId);
        },
      });

      const handle = await adapter.start({
        projectId: "smoke-project",
        researchTaskId: "smoke-research-task",
        agentTaskId: "smoke-agent-task",
        runId: "smoke-run",
        taskRequest: {
          objective:
            "Return a concise JSON object with visibleMessageSummary set to SDK_SMOKE_OK and no scientific changes.",
        },
        snapshot: {
          id: "smoke-snapshot",
          projectId: "smoke-project",
          researchQuestionRevisionId: null,
          theoryRevisionId: null,
          researchDesignRevisionId: null,
          dataVersionRef: null,
          assetVersionRefs: [],
          gitBaseCommit: null,
          skillVersionRefs: [],
          harnessVersion:
            "4878cdabd87d4041bdaff61d04c966883b9fd07a",
          harnessProfile: "sdk",
          runtimeProfile: "research-execution",
          modelRoute: "deepseek-official/deepseek-v4-flash",
          sandboxPolicy: "read-only",
          toolAllowlist: ["read_file"],
          subagentAllowlist: [],
          createdBy: { type: "system", id: "smoke" },
          createdAt: new Date(),
        },
        cwd: process.cwd(),
        toolAllowlist: ["read_file"],
        subagentAllowlist: [],
        sandboxPolicy: "read-only",
        envAllowlist: ["PATH", "HOME", "DEEPSEEK_API_KEY"],
        outputSchema: {
          type: "object",
          required: ["visibleMessageSummary"],
        },
      });

      expect(recorded).toEqual(["rw-smoke-run"]);
      expect(handle.state).toBe("completed");
      expect(handle.result?.visibleMessageSummary).toContain("SDK_SMOKE_OK");
    },
    180_000,
  );
});
