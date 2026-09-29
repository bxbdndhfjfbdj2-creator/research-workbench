import type {
  HarnessExecutionHandle,
  HarnessExecutionRequest,
  HarnessHealth,
  HarnessResumeRequest,
} from "./types";

export interface HarnessAdapter {
  start(request: HarnessExecutionRequest): Promise<HarnessExecutionHandle>;
  resume(request: HarnessResumeRequest): Promise<HarnessExecutionHandle>;
  cancel(runId: string): Promise<void>;
  health(): Promise<HarnessHealth>;
}
