import { describe, expect, it } from "vitest";
import type {
  HarnessExecutionRequest,
  HarnessExecutionResult,
} from "./types";
import { FakeHarnessAdapter } from "./fake-adapter";

function allKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(allKeys);
  const record = value as Record<string, unknown>;
  return [
    ...Object.keys(record),
    ...Object.values(record).flatMap(allKeys),
  ];
}

const request: HarnessExecutionRequest = {
  projectId: "project-1",
  researchTaskId: "research-task-1",
  agentTaskId: "agent-task-1",
  runId: "run-1",
  taskRequest: {
    objective: "分析研究异常",
    expectedOutput: "结构化摘要",
  },
  snapshot: {
    id: "snapshot-1",
    projectId: "project-1",
    researchQuestionRevisionId: "rq-rev-1",
    theoryRevisionId: "theory-rev-1",
    researchDesignRevisionId: "design-rev-1",
    dataVersionRef: "data:v1",
    assetVersionRefs: [],
    gitBaseCommit: "0123456789abcdef0123456789abcdef01234567",
    skillVersionRefs: ["skill:analysis@1"],
    harnessVersion: "test-harness",
    harnessProfile: "workbench",
    runtimeProfile: "research-execution",
    modelRoute: "default",
    sandboxPolicy: "workspace-write",
    toolAllowlist: ["read_file", "write_file"],
    subagentAllowlist: ["codex"],
    createdBy: { type: "human", id: "member-1" },
    createdAt: new Date("2026-09-29T00:00:00Z"),
  },
  cwd: "/workspace/project-1",
  toolAllowlist: ["read_file", "write_file"],
  subagentAllowlist: ["codex"],
  sandboxPolicy: "workspace-write",
  outputSchema: {
    type: "object",
    required: ["summary"],
  },
};

const completedResult: HarnessExecutionResult = {
  visibleMessageSummary: "分析完成",
  toolFacts: [
    { tool: "read_file", summary: "读取分析脚本" },
  ],
  artifactRefs: ["artifact:diagnostic-report"],
  githubHints: [
    { kind: "commit", value: "0123456789abcdef0123456789abcdef01234567" },
  ],
  scientificChangeProposals: [],
  stopReason: "completed",
};

describe("HarnessAdapter contract", () => {
  it("implements start, resume, cancel and health with deterministic scripted results", async () => {
    const adapter = new FakeHarnessAdapter([
      { state: "waiting_human", sessionId: "session-1" },
      { state: "completed", sessionId: "session-1", result: completedResult },
    ]);

    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.cancel).toBe("function");
    expect(typeof adapter.health).toBe("function");

    await expect(adapter.health()).resolves.toMatchObject({ status: "available" });

    const waiting = await adapter.start(request);
    expect(waiting).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      state: "waiting_human",
    });

    const completed = await adapter.resume({
      runId: "run-1",
      sessionId: "session-1",
      resumePayload: { answer: "继续" },
    });
    expect(completed).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      state: "completed",
      result: completedResult,
    });

    await expect(adapter.cancel("run-1")).resolves.toBeUndefined();
  });

  it("exposes only auditable visible output, never hidden reasoning or raw credentials", async () => {
    const adapter = new FakeHarnessAdapter([
      { state: "completed", sessionId: "session-safe", result: completedResult },
    ]);
    const handle = await adapter.start(request);
    const keys = allKeys(handle).map((key) => key.toLowerCase());

    expect(keys).not.toContain("hiddenreasoning");
    expect(keys).not.toContain("rawcredential");
    expect(keys).not.toContain("rawcredentials");
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("token");
    expect(handle.result?.visibleMessageSummary).toBe("分析完成");
  });

  it("supports failed scripts without fabricating a successful result", async () => {
    const adapter = new FakeHarnessAdapter([
      {
        state: "failed",
        sessionId: "session-failed",
        result: {
          visibleMessageSummary: "Harness 执行失败",
          toolFacts: [],
          artifactRefs: [],
          githubHints: [],
          scientificChangeProposals: [],
          stopReason: "failed",
        },
      },
    ]);

    const handle = await adapter.start(request);
    expect(handle.state).toBe("failed");
    expect(handle.result?.stopReason).toBe("failed");
  });
});
