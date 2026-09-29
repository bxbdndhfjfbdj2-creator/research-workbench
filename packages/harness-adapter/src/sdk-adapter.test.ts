import { describe, expect, it } from "vitest";
import {
  SdkHarnessAdapter,
  type SdkRuntime,
  type SdkRuntimeFactoryOptions,
} from "./sdk-adapter";
import type { HarnessExecutionRequest } from "./types";

const request: HarnessExecutionRequest = {
  projectId: "project-sdk",
  researchTaskId: "research-task-sdk",
  agentTaskId: "agent-task-sdk",
  runId: "run-sdk",
  taskRequest: {
    objective: "诊断主效应变化",
    expectedOutput: "结构化诊断",
  },
  snapshot: {
    id: "snapshot-sdk",
    projectId: "project-sdk",
    researchQuestionRevisionId: "rq-1",
    theoryRevisionId: "theory-1",
    researchDesignRevisionId: "design-1",
    dataVersionRef: "data:v3",
    assetVersionRefs: ["asset:dictionary@2"],
    gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
    skillVersionRefs: ["skill:diagnostic@1"],
    harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
    harnessProfile: "sdk",
    runtimeProfile: "research-execution",
    modelRoute: "deepseek-official/deepseek-v4-flash",
    sandboxPolicy: "workspace-write",
    toolAllowlist: ["read_file", "write_file"],
    subagentAllowlist: [],
    createdBy: { type: "human", id: "member-1" },
    createdAt: new Date("2026-09-29T00:00:00Z"),
  },
  cwd: "/workspace/project-sdk",
  toolAllowlist: ["read_file", "write_file"],
  subagentAllowlist: [],
  sandboxPolicy: "workspace-write",
  envAllowlist: ["PATH", "DEEPSEEK_API_KEY"],
  outputSchema: {
    type: "object",
    required: ["visibleMessageSummary"],
  },
};

describe("SdkHarnessAdapter", () => {
  it("uses pinned runtime settings, a strict environment allowlist and records the session before prompting", async () => {
    const order: string[] = [];
    let launch: SdkRuntimeFactoryOptions | undefined;
    let prompt = "";
    let sessionId = "";

    const runtime: SdkRuntime = {
      async start() {
        order.push("runtime.start");
      },
      async run(input, options) {
        order.push("runtime.run");
        prompt = input;
        sessionId = options.sessionId;
        return {
          sessionId: options.sessionId,
          finalResponse: JSON.stringify({
            visibleMessageSummary: "诊断完成",
            toolFacts: [{ tool: "read_file", summary: "读取分析输入" }],
            artifactRefs: ["artifact:diagnostic"],
            githubHints: [],
            scientificChangeProposals: [],
            stopReason: "completed",
          }),
          events: [],
          notifications: [],
        };
      },
      async close() {
        order.push("runtime.close");
      },
    };

    const adapter = new SdkHarnessAdapter({
      dshBin: "/opt/pinned/dsh/lib/bin.js",
      dshHome: "/var/lib/research-workbench/dsh",
      profile: "sdk",
      patchPaths: ["/app/infra/harness/workbench.cordis.yml"],
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      pinnedHarnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      allowedEnvironmentNames: ["PATH", "DEEPSEEK_API_KEY"],
      processEnv: {
        PATH: "/usr/bin",
        DEEPSEEK_API_KEY: "runtime-secret",
        UNRELATED_SECRET: "must-not-leak",
      },
      runtimeFactory(options) {
        launch = options;
        return runtime;
      },
      async recordSessionReference(reference) {
        order.push("session.record");
        expect(reference).toMatchObject({
          runId: "run-sdk",
          sessionId: "rw-run-sdk",
          runtimeProfile: "research-execution",
          harnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
        });
      },
    });

    const result = await adapter.start(request);

    expect(order).toEqual([
      "runtime.start",
      "session.record",
      "runtime.run",
      "runtime.close",
    ]);
    expect(sessionId).toBe("rw-run-sdk");
    expect(launch).toMatchObject({
      dshBin: "/opt/pinned/dsh/lib/bin.js",
      dshHome: "/var/lib/research-workbench/dsh",
      profile: "sdk",
      patches: ["/app/infra/harness/workbench.cordis.yml"],
      cwd: "/workspace/project-sdk",
      processCwd: "/workspace/project-sdk",
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      env: {
        PATH: "/usr/bin",
        DEEPSEEK_API_KEY: "runtime-secret",
        DSH_PERMISSION_MODE: "workspace-write",
        DSH_TELEMETRY_MODE: "DISABLED",
        RW_TOOL_ALLOWLIST: JSON.stringify(["read_file", "write_file"]),
        RW_SUBAGENT_ALLOWLIST: JSON.stringify([]),
      },
    });
    expect((launch?.env as Record<string, string | undefined>).UNRELATED_SECRET).toBeUndefined();
    expect(prompt).toContain('"objective":"诊断主效应变化"');
    expect(prompt).not.toContain("runtime-secret");
    expect(result).toMatchObject({
      runId: "run-sdk",
      sessionId: "rw-run-sdk",
      state: "completed",
      result: {
        visibleMessageSummary: "诊断完成",
        stopReason: "completed",
      },
    });
  });

  it("rejects an environment name outside the deployment allowlist before starting Harness", async () => {
    let factoryCalls = 0;
    const adapter = new SdkHarnessAdapter({
      dshBin: "/opt/pinned/dsh/lib/bin.js",
      dshHome: "/var/lib/research-workbench/dsh",
      profile: "sdk",
      patchPaths: [],
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      pinnedHarnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      allowedEnvironmentNames: ["PATH"],
      processEnv: { PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "nope" },
      runtimeFactory() {
        factoryCalls += 1;
        throw new Error("must not start");
      },
      async recordSessionReference() {},
    });

    await expect(
      adapter.start({
        ...request,
        envAllowlist: ["PATH", "AWS_SECRET_ACCESS_KEY"],
      }),
    ).rejects.toThrow(/allowlist|environment/i);
    expect(factoryCalls).toBe(0);
  });

  it("rejects danger-full-access unless the deployment explicitly enables it", async () => {
    const adapter = new SdkHarnessAdapter({
      dshBin: "/opt/pinned/dsh/lib/bin.js",
      dshHome: "/var/lib/research-workbench/dsh",
      profile: "sdk",
      patchPaths: [],
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      pinnedHarnessVersion: "4878cdabd87d4041bdaff61d04c966883b9fd07a",
      allowedEnvironmentNames: [],
      processEnv: {},
      runtimeFactory() {
        throw new Error("must not start");
      },
      async recordSessionReference() {},
    });

    await expect(
      adapter.start({
        ...request,
        sandboxPolicy: "danger-full-access",
        snapshot: { ...request.snapshot, sandboxPolicy: "danger-full-access" },
        envAllowlist: [],
      }),
    ).rejects.toThrow(/danger-full-access|administrator/i);
  });
});
