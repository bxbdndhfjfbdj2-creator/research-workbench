import { describe, expect, it } from "vitest";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type {
  SdkRuntime,
  SdkRuntimeFactoryOptions,
} from "../../../packages/harness-adapter/src/sdk-adapter";
import type { HarnessExecutionRequest } from "../../../packages/harness-adapter/src/types";
import { createProductionHarnessAdapter } from "./production-runtime";

const request: HarnessExecutionRequest = {
  projectId: "worker-project",
  researchTaskId: "worker-research-task",
  agentTaskId: "worker-agent-task",
  runId: "worker-run",
  taskRequest: { objective: "运行生产装配测试" },
  snapshot: {
    id: "worker-snapshot",
    projectId: "worker-project",
    researchQuestionRevisionId: null,
    theoryRevisionId: null,
    researchDesignRevisionId: null,
    dataVersionRef: null,
    assetVersionRefs: [],
    gitBaseCommit: null,
    skillVersionRefs: [],
    harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    harnessProfile: "sdk",
    runtimeProfile: "research-execution",
    modelRoute: "deepseek-official/deepseek-v4-flash",
    sandboxPolicy: "read-only",
    toolAllowlist: ["read_file"],
    subagentAllowlist: [],
    createdBy: { type: "human", id: "researcher-1" },
    createdAt: new Date("2026-09-29T00:00:00Z"),
  },
  cwd: "/workspace/worker-project",
  toolAllowlist: ["read_file"],
  subagentAllowlist: [],
  sandboxPolicy: "read-only",
  envAllowlist: ["PATH"],
  outputSchema: { type: "object" },
};

describe("production Agent runtime composition", () => {
  it("issues a short-lived per-Run callback credential and injects only the token into the Harness child", async () => {
    let launch: SdkRuntimeFactoryOptions | undefined;
    const issued: string[] = [];
    const recorded: string[] = [];

    const runtime: SdkRuntime = {
      async start() {},
      async run(_input, options) {
        return {
          sessionId: options.sessionId,
          finalResponse: JSON.stringify({
            visibleMessageSummary: "done",
            toolFacts: [],
            artifactRefs: [],
            githubHints: [],
            scientificChangeProposals: [],
            stopReason: "completed",
          }),
          events: [],
          notifications: [],
        };
      },
      async close() {},
    };

    const adapter = createProductionHarnessAdapter(
      {} as DatabaseSql,
      {
        dshBin: "/opt/dsh/bin.js",
        dshHome: "/var/lib/rw/dsh",
        profile: "sdk",
        patchPaths: ["/app/infra/harness/workbench.cordis.yml"],
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
        pinnedHarnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
        allowedEnvironmentNames: ["PATH"],
        processEnv: { PATH: "/usr/bin" },
        callbackEndpoint:
          "https://workbench.internal/api/internal/agent-interaction",
        callbackSigningSecret: "signing-secret",
        callbackTtlSeconds: 900,
        runtimeFactory(options) {
          launch = options;
          return runtime;
        },
      },
      {
        async issueCallbackCredential(_sql, runId, signingSecret, ttlSeconds) {
          issued.push([runId, signingSecret, String(ttlSeconds)].join(":"));
          return {
            credentialRef: "credential-ref",
            token: "ephemeral-worker-token",
            expiresAt: new Date("2026-09-29T00:15:00Z"),
          };
        },
        async recordSessionReference(_sql, runId, sessionId) {
          recorded.push(runId + ":" + sessionId);
          return {} as never;
        },
      },
    );

    await adapter.start(request);

    expect(issued).toEqual(["worker-run:signing-secret:900"]);
    expect(recorded).toEqual(["worker-run:rw-worker-run"]);
    expect(launch?.env).toMatchObject({
      PATH: "/usr/bin",
      RW_AGENT_RUN_ID: "worker-run",
      RW_AGENT_CALLBACK_ENDPOINT:
        "https://workbench.internal/api/internal/agent-interaction",
      RW_AGENT_CALLBACK_TOKEN: "ephemeral-worker-token",
    });
    expect(JSON.stringify(request)).not.toContain("ephemeral-worker-token");
  });
});
