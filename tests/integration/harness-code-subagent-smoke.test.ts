import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SdkHarnessAdapter } from "../../packages/harness-adapter/src/sdk-adapter";

const exec = promisify(execFile);
const MARKER = "RESEARCH_WORKBENCH_CODE_SUBAGENT_SMOKE";

describe("Harness coding subagent configuration", () => {
  it("keeps both coding providers opt-in and excludes danger-full-access from the preset", async () => {
    const preset = await readFile(
      resolve(process.cwd(), "infra/harness/presets/research-execution.yml"),
      "utf8",
    );
    expect(preset).toContain("providerName: codex");
    expect(preset).toContain("permissionMode: never");
    expect(preset).toContain("providerName: claude-code");
    expect(preset).toContain("permissionMode: dontAsk");
    expect(preset).toContain("subagent_codex");
    expect(preset).toContain("subagent_claude_code");
    expect(preset).not.toContain("danger-full-access");
    expect(preset).not.toContain("bypassPermissions");
    expect(preset).not.toContain("dangerously-bypass-approvals-and-sandbox");
  });

  const provider = process.env.RW_CODE_SUBAGENT;
  const configured =
    (provider === "codex" || provider === "claude-code") &&
    Boolean(process.env.RW_DSH_BIN);
  const realIt = configured ? it : it.skip;

  realIt(
    "delegates a real coding task that changes the temporary Git workspace",
    async () => {
      if (provider !== "codex" && provider !== "claude-code") {
        throw new Error("RW_CODE_SUBAGENT must be codex or claude-code");
      }

      const workspace = await mkdtemp(join(tmpdir(), "rw-code-subagent-"));
      try {
        await exec("git", ["init"], { cwd: workspace });
        await exec("git", ["config", "user.email", "smoke@research-workbench.test"], { cwd: workspace });
        await exec("git", ["config", "user.name", "Research Workbench Smoke"], { cwd: workspace });
        await exec("git", ["commit", "--allow-empty", "-m", "baseline"], { cwd: workspace });

        const adapter = new SdkHarnessAdapter({
          dshBin: process.env.RW_DSH_BIN!,
          dshHome:
            process.env.RW_DSH_HOME ??
            resolve(process.cwd(), ".tmp/harness-code-subagent-home"),
          profile: "sdk",
          patchPaths: [
            resolve(process.cwd(), "infra/harness/workbench.cordis.yml"),
            resolve(process.cwd(), "infra/harness/presets/research-execution.yml"),
          ],
          provider: process.env.RW_DSH_PROVIDER ?? "deepseek-official",
          model: process.env.RW_DSH_MODEL ?? "deepseek-v4-flash",
          pinnedHarnessVersion:
            "4878cdabd87d4041bdaff61d04c966883b9fd07a",
          allowedEnvironmentNames: [
            "PATH",
            "HOME",
            "DEEPSEEK_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "CODEX_HOME",
          ],
          async recordSessionReference() {},
        });

        const handle = await adapter.start({
          projectId: "code-smoke-project",
          researchTaskId: "code-smoke-research-task",
          agentTaskId: "code-smoke-agent-task",
          runId: "code-smoke-run",
          taskRequest: {
            objective:
              "Use the configured coding subagent tool to create agent-smoke.txt in the current workspace with exactly the required marker.",
            requiredMarker: MARKER,
            requiredProvider: provider,
          },
          snapshot: {
            id: "code-smoke-snapshot",
            projectId: "code-smoke-project",
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
            sandboxPolicy: "workspace-write",
            toolAllowlist: ["read_file"],
            subagentAllowlist: [provider],
            createdBy: { type: "system", id: "code-smoke" },
            createdAt: new Date(),
          },
          cwd: workspace,
          toolAllowlist: ["read_file"],
          subagentAllowlist: [provider],
          sandboxPolicy: "workspace-write",
          envAllowlist: [
            "PATH",
            "HOME",
            "DEEPSEEK_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "CODEX_HOME",
          ],
          outputSchema: {
            type: "object",
            required: ["visibleMessageSummary", "artifactRefs"],
          },
        });

        expect(handle.state).toBe("completed");
        expect((await readFile(join(workspace, "agent-smoke.txt"), "utf8")).trim()).toBe(MARKER);
        const diff = await exec("git", ["status", "--short"], { cwd: workspace });
        expect(diff.stdout).toContain("agent-smoke.txt");
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
