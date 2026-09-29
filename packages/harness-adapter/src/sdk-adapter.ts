import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { assertSecretSafe, type JsonValue } from "../../domain/src/events";
import type { HarnessAdapter } from "./adapter";
import type {
  HarnessExecutionHandle,
  HarnessExecutionRequest,
  HarnessExecutionResult,
  HarnessGitHubHint,
  HarnessHealth,
  HarnessResumeRequest,
  HarnessScientificChangeProposal,
  HarnessStopReason,
  HarnessToolFact,
} from "./types";

export type SdkEnvironment = Record<string, string | undefined>;

export type SdkRuntimeFactoryOptions = {
  dshBin: string;
  profile: string;
  patches: string[];
  dshHome: string;
  cwd: string;
  processCwd: string;
  env: SdkEnvironment;
  provider: string;
  model: string;
};

export type SdkRuntimeRunResult = {
  sessionId: string;
  finalResponse: string;
  events: unknown[];
  notifications: unknown[];
};

export interface SdkRuntime {
  start(): Promise<void>;
  run(
    input: string,
    options: { sessionId: string },
  ): Promise<SdkRuntimeRunResult>;
  close(): Promise<void>;
}

export type SessionReferenceInput = {
  runId: string;
  sessionId: string;
  runtimeProfile: string;
  harnessVersion: string;
};

export type SessionReferenceResolution = SessionReferenceInput & {
  generation?: number;
};

export type SdkHarnessAdapterOptions = {
  dshBin: string;
  dshHome: string;
  profile: string;
  patchPaths: string[];
  provider: string;
  model: string;
  pinnedHarnessVersion: string;
  allowedEnvironmentNames: string[];
  allowDangerFullAccess?: boolean;
  processEnv?: SdkEnvironment;
  runtimeFactory?: (options: SdkRuntimeFactoryOptions) => SdkRuntime;
  recordSessionReference: (reference: SessionReferenceInput) => Promise<void>;
  resolveSessionReference?: (
    runId: string,
  ) => Promise<SessionReferenceResolution | null>;
  loadExecutionRequest?: (
    runId: string,
  ) => Promise<HarnessExecutionRequest | null>;
  resolveHumanInteractionBridge?: (
    request: HarnessExecutionRequest,
  ) => Promise<{ endpoint: string; callbackToken: string } | null>;
};

type ActiveRuntime = {
  runtime: SdkRuntime;
  sessionId: string;
  request: HarnessExecutionRequest;
};

const VISIBLE_STOP_REASONS = new Set<HarnessStopReason>([
  "completed",
  "failed",
  "waiting_human",
  "cancelled",
]);

function defaultRuntimeFactory(
  options: SdkRuntimeFactoryOptions,
): SdkRuntime {
  const harness = new DeepSeekHarness({
    ...options,
    env: options.env as NodeJS.ProcessEnv,
  });
  return {
    start: () => harness.start(),
    run: async (input, runOptions) => {
      const result = await harness.run(input, runOptions);
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        events: result.events,
        notifications: result.notifications,
      };
    },
    close: () => harness.close(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseToolFacts(value: unknown): HarnessToolFact[] {
  if (!Array.isArray(value)) return [];
  const facts: HarnessToolFact[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.tool !== "string" || typeof record.summary !== "string") {
      continue;
    }
    facts.push({ tool: record.tool, summary: record.summary });
  }
  return facts;
}

function parseGitHubHints(value: unknown): HarnessGitHubHint[] {
  if (!Array.isArray(value)) return [];
  const hints: HarnessGitHubHint[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.kind !== "string" || typeof record.value !== "string") {
      continue;
    }
    hints.push({ kind: record.kind, value: record.value });
  }
  return hints;
}

function parseScientificChangeProposals(
  value: unknown,
): HarnessScientificChangeProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: HarnessScientificChangeProposal[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    if (typeof record.title !== "string" || typeof record.reason !== "string") {
      continue;
    }
    const proposal: HarnessScientificChangeProposal = {
      title: record.title,
      reason: record.reason,
    };
    if (record.evidence !== undefined) {
      proposal.evidence = record.evidence as JsonValue;
    }
    if (record.change !== undefined) {
      proposal.change = record.change as JsonValue;
    }
    const impact = asStringArray(record.impact);
    if (impact.length > 0) proposal.impact = impact;
    proposals.push(proposal);
  }
  return proposals;
}

function parseResearchResult(value: unknown): HarnessExecutionResult["researchResult"] {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  if (
    typeof record.dataVersionRef !== "string" ||
    typeof record.analysisRevisionId !== "string" ||
    (record.executionKind !== "manual" && record.executionKind !== "code") ||
    !Array.isArray(record.outputRefs) ||
    !record.outputRefs.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  const parsed: NonNullable<HarnessExecutionResult["researchResult"]> = {
    dataVersionRef: record.dataVersionRef,
    analysisRevisionId: record.analysisRevisionId,
    executionKind: record.executionKind,
    outputRefs: record.outputRefs as string[],
  };
  if (record.gitCommit !== undefined) {
    const git = asRecord(record.gitCommit);
    if (
      git &&
      typeof git.repositoryFullName === "string" &&
      typeof git.sha === "string"
    ) {
      parsed.gitCommit = {
        repositoryFullName: git.repositoryFullName,
        sha: git.sha,
      };
    }
  }
  return parsed;
}

function safeFailureResult(summary: string): HarnessExecutionResult {
  return {
    visibleMessageSummary: summary,
    toolFacts: [],
    artifactRefs: [],
    githubHints: [],
    scientificChangeProposals: [],
    stopReason: "failed",
  };
}

function parseExecutionResult(finalResponse: string): HarnessExecutionResult {
  const trimmed = finalResponse.trim();
  if (!trimmed) {
    return safeFailureResult("Harness returned no visible assistant response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      visibleMessageSummary: trimmed,
      toolFacts: [],
      artifactRefs: [],
      githubHints: [],
      scientificChangeProposals: [],
      stopReason: "completed",
    };
  }

  const record = asRecord(parsed);
  if (!record) {
    return {
      visibleMessageSummary: trimmed,
      toolFacts: [],
      artifactRefs: [],
      githubHints: [],
      scientificChangeProposals: [],
      stopReason: "completed",
    };
  }

  const stopReason =
    typeof record.stopReason === "string" &&
    VISIBLE_STOP_REASONS.has(record.stopReason as HarnessStopReason)
      ? (record.stopReason as HarnessStopReason)
      : "completed";

  const result: HarnessExecutionResult = {
    visibleMessageSummary:
      typeof record.visibleMessageSummary === "string"
        ? record.visibleMessageSummary
        : typeof record.summary === "string"
          ? record.summary
          : trimmed,
    toolFacts: parseToolFacts(record.toolFacts),
    artifactRefs: asStringArray(record.artifactRefs),
    githubHints: parseGitHubHints(record.githubHints),
    scientificChangeProposals: parseScientificChangeProposals(
      record.scientificChangeProposals,
    ),
    ...(parseResearchResult(record.researchResult) === undefined
      ? {}
      : { researchResult: parseResearchResult(record.researchResult) }),
    stopReason,
  };

  try {
    assertSecretSafe(result as unknown as JsonValue);
    return result;
  } catch {
    return safeFailureResult(
      "Harness output was rejected by the credential-safety policy",
    );
  }
}

function stateForResult(
  result: HarnessExecutionResult,
): HarnessExecutionHandle["state"] {
  switch (result.stopReason) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "waiting_human":
      return "waiting_human";
    case "cancelled":
      return "cancelled";
  }
}

function stableSessionId(runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "-");
  return `rw-${safeRunId}`;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class SdkHarnessAdapter implements HarnessAdapter {
  private readonly options: SdkHarnessAdapterOptions;
  private readonly runtimeFactory: (
    options: SdkRuntimeFactoryOptions,
  ) => SdkRuntime;
  private readonly active = new Map<string, ActiveRuntime>();

  constructor(options: SdkHarnessAdapterOptions) {
    this.options = options;
    this.runtimeFactory = options.runtimeFactory ?? defaultRuntimeFactory;
  }

  async health(): Promise<HarnessHealth> {
    if (!this.options.dshBin.trim()) {
      return { status: "unavailable", detail: "Pinned dshBin is not configured" };
    }
    if (!this.options.pinnedHarnessVersion.trim()) {
      return {
        status: "unavailable",
        detail: "Pinned Harness version is not configured",
      };
    }
    return { status: "available" };
  }

  async start(
    request: HarnessExecutionRequest,
  ): Promise<HarnessExecutionHandle> {
    this.validateRequest(request);
    const sessionId = stableSessionId(request.runId);
    const runtime = this.runtimeFactory(await this.launchOptions(request));

    try {
      await runtime.start();
      await this.options.recordSessionReference({
        runId: request.runId,
        sessionId,
        runtimeProfile: request.snapshot.runtimeProfile,
        harnessVersion: request.snapshot.harnessVersion,
      });
      this.active.set(request.runId, { runtime, sessionId, request });

      const runResult = await runtime.run(this.initialPrompt(request), {
        sessionId,
      });
      if (runResult.sessionId !== sessionId) {
        throw new Error("Harness SDK returned an unexpected session id");
      }

      const result = parseExecutionResult(runResult.finalResponse);
      const handle: HarnessExecutionHandle = {
        runId: request.runId,
        sessionId,
        state: stateForResult(result),
        result,
      };
      if (handle.state !== "waiting_human" && handle.state !== "running") {
        await this.closeActive(request.runId);
      }
      return handle;
    } catch (error) {
      await this.closeActive(request.runId, runtime);
      throw error;
    }
  }

  async resume(
    request: HarnessResumeRequest,
  ): Promise<HarnessExecutionHandle> {
    assertSecretSafe(request.resumePayload);
    let active = this.active.get(request.runId);

    if (!active) {
      const executionRequest =
        await this.options.loadExecutionRequest?.(request.runId);
      const reference =
        await this.options.resolveSessionReference?.(request.runId);
      if (!executionRequest || !reference) {
        throw new Error(
          "Harness resume requires an active runtime or persisted execution context",
        );
      }
      if (reference.sessionId !== request.sessionId) {
        throw new Error("Harness resume session does not match persisted reference");
      }
      this.validateRequest(executionRequest);
      const runtime = this.runtimeFactory(await this.launchOptions(executionRequest));
      await runtime.start();
      await this.options.recordSessionReference({
        runId: request.runId,
        sessionId: request.sessionId,
        runtimeProfile: executionRequest.snapshot.runtimeProfile,
        harnessVersion: executionRequest.snapshot.harnessVersion,
      });
      active = {
        runtime,
        sessionId: request.sessionId,
        request: executionRequest,
      };
      this.active.set(request.runId, active);
    }

    if (active.sessionId !== request.sessionId) {
      throw new Error("Harness resume session id mismatch");
    }

    try {
      const runResult = await active.runtime.run(
        JSON.stringify({
          protocol: "research-workbench.human-response.v1",
          runId: request.runId,
          response: request.resumePayload,
          instruction:
            "Continue from the persisted research context. Return only user-visible conclusions and structured facts; do not expose hidden reasoning.",
        }),
        { sessionId: active.sessionId },
      );
      const result = parseExecutionResult(runResult.finalResponse);
      const handle: HarnessExecutionHandle = {
        runId: request.runId,
        sessionId: active.sessionId,
        state: stateForResult(result),
        result,
      };
      if (handle.state !== "waiting_human" && handle.state !== "running") {
        await this.closeActive(request.runId);
      }
      return handle;
    } catch (error) {
      await this.closeActive(request.runId);
      throw error;
    }
  }

  async cancel(runId: string): Promise<void> {
    await this.closeActive(runId);
  }

  private validateRequest(request: HarnessExecutionRequest): void {
    if (request.snapshot.projectId !== request.projectId) {
      throw new Error("Harness request project does not match its context snapshot");
    }
    if (request.snapshot.harnessVersion !== this.options.pinnedHarnessVersion) {
      throw new Error("Harness request does not match the pinned Harness version");
    }
    if (request.snapshot.harnessProfile !== this.options.profile) {
      throw new Error("Harness request does not match the configured Harness profile");
    }
    if (request.snapshot.sandboxPolicy !== request.sandboxPolicy) {
      throw new Error("Harness sandbox policy differs from the frozen snapshot");
    }
    if (!sameStringSet(request.snapshot.toolAllowlist, request.toolAllowlist)) {
      throw new Error("Harness tool allowlist differs from the frozen snapshot");
    }
    if (
      !sameStringSet(
        request.snapshot.subagentAllowlist,
        request.subagentAllowlist,
      )
    ) {
      throw new Error("Harness subagent allowlist differs from the frozen snapshot");
    }
    if (
      request.sandboxPolicy === "danger-full-access" &&
      !this.options.allowDangerFullAccess
    ) {
      throw new Error(
        "danger-full-access requires an explicit administrator deployment policy",
      );
    }

    const allowed = new Set(this.options.allowedEnvironmentNames);
    for (const name of request.envAllowlist ?? this.options.allowedEnvironmentNames) {
      if (!allowed.has(name)) {
        throw new Error(
          `Environment variable ${name} is outside the deployment allowlist`,
        );
      }
    }
  }

  private async launchOptions(
    request: HarnessExecutionRequest,
  ): Promise<SdkRuntimeFactoryOptions> {
    const requestedEnvironmentNames =
      request.envAllowlist ?? this.options.allowedEnvironmentNames;
    const sourceEnv = this.options.processEnv ?? process.env;
    const env: SdkEnvironment = {};

    for (const name of requestedEnvironmentNames) {
      const value = sourceEnv[name];
      if (value !== undefined) env[name] = value;
    }

    env.DSH_PERMISSION_MODE = this.effectiveSandboxPolicy(request);
    env.DSH_TELEMETRY_MODE = "DISABLED";
    env.RW_TOOL_ALLOWLIST = JSON.stringify(request.toolAllowlist);
    env.RW_SUBAGENT_ALLOWLIST = JSON.stringify(request.subagentAllowlist);

    const bridge = await this.options.resolveHumanInteractionBridge?.(request);
    if (bridge) {
      if (!bridge.endpoint.trim() || !bridge.callbackToken.trim()) {
        throw new Error("Workbench human interaction bridge configuration is incomplete");
      }
      let endpoint: URL;
      try {
        endpoint = new URL(bridge.endpoint);
      } catch {
        throw new Error("Workbench human interaction bridge endpoint is invalid");
      }
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
        throw new Error("Workbench human interaction bridge endpoint must use HTTP(S)");
      }
      env.RW_AGENT_RUN_ID = request.runId;
      env.RW_AGENT_CALLBACK_ENDPOINT = bridge.endpoint;
      env.RW_AGENT_CALLBACK_TOKEN = bridge.callbackToken;
    }

    return {
      dshBin: this.options.dshBin,
      dshHome: this.options.dshHome,
      profile: this.options.profile,
      patches: [...this.options.patchPaths],
      cwd: request.cwd,
      processCwd: request.cwd,
      env,
      provider: this.options.provider,
      model: this.options.model,
    };
  }

  private effectiveSandboxPolicy(
    request: HarnessExecutionRequest,
  ): HarnessExecutionRequest["sandboxPolicy"] {
    if (request.sandboxPolicy !== "workspace-write") {
      return request.sandboxPolicy;
    }
    const mutatingCapability = request.toolAllowlist.some((tool) =>
      ["write_file", "edit_file", "bash", "powershell", "workflow"].includes(
        tool,
      ),
    ) || request.subagentAllowlist.length > 0;
    return mutatingCapability ? "workspace-write" : "read-only";
  }

  private initialPrompt(request: HarnessExecutionRequest): string {
    return JSON.stringify({
      protocol: "research-workbench.agent-task.v1",
      ids: {
        projectId: request.projectId,
        researchTaskId: request.researchTaskId,
        agentTaskId: request.agentTaskId,
        runId: request.runId,
        snapshotId: request.snapshot.id,
      },
      task: request.taskRequest,
      context: {
        researchQuestionRevisionId:
          request.snapshot.researchQuestionRevisionId,
        theoryRevisionId: request.snapshot.theoryRevisionId,
        researchDesignRevisionId:
          request.snapshot.researchDesignRevisionId,
        dataVersionRef: request.snapshot.dataVersionRef,
        assetVersionRefs: request.snapshot.assetVersionRefs,
        gitBaseCommit: request.snapshot.gitBaseCommit,
        skillVersionRefs: request.snapshot.skillVersionRefs,
      },
      executionPolicy: {
        sandboxPolicy: request.sandboxPolicy,
        toolAllowlist: request.toolAllowlist,
        subagentAllowlist: request.subagentAllowlist,
      },
      outputSchema: request.outputSchema,
      instructions: [
        "Return only user-visible conclusions and auditable execution facts.",
        "Do not expose hidden chain-of-thought or hidden reasoning.",
        "A scientific change must be returned only as a proposal; never treat it as an approved formal research-state change.",
      ],
    });
  }

  private async closeActive(
    runId: string,
    fallbackRuntime?: SdkRuntime,
  ): Promise<void> {
    const active = this.active.get(runId);
    this.active.delete(runId);
    const runtime = active?.runtime ?? fallbackRuntime;
    if (runtime) await runtime.close();
  }
}
