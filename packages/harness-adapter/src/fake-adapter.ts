import type { HarnessAdapter } from "./adapter";
import type {
  FakeHarnessScriptStep,
  HarnessExecutionHandle,
  HarnessExecutionRequest,
  HarnessHealth,
  HarnessResumeRequest,
} from "./types";

export class FakeHarnessAdapter implements HarnessAdapter {
  private readonly script: FakeHarnessScriptStep[];
  private readonly cancelledRuns = new Set<string>();
  private readonly healthState: HarnessHealth;

  constructor(
    script: FakeHarnessScriptStep[],
    healthState: HarnessHealth = { status: "available" },
  ) {
    this.script = [...script];
    this.healthState = healthState;
  }

  async start(request: HarnessExecutionRequest): Promise<HarnessExecutionHandle> {
    return this.nextStep(request.runId);
  }

  async resume(request: HarnessResumeRequest): Promise<HarnessExecutionHandle> {
    if (this.cancelledRuns.has(request.runId)) {
      return {
        runId: request.runId,
        sessionId: request.sessionId,
        state: "cancelled",
        result: {
          visibleMessageSummary: "Run cancelled",
          toolFacts: [],
          artifactRefs: [],
          githubHints: [],
          scientificChangeProposals: [],
          stopReason: "cancelled",
        },
      };
    }
    return this.nextStep(request.runId);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelledRuns.add(runId);
  }

  async health(): Promise<HarnessHealth> {
    return this.healthState;
  }

  private nextStep(runId: string): HarnessExecutionHandle {
    const step = this.script.shift();
    if (!step) {
      throw new Error("FakeHarnessAdapter script exhausted");
    }
    return {
      runId,
      ...step,
    };
  }
}
