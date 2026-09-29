import type { DatabaseSql } from "@research-workbench/db/src/client";
import {
  getCurrentHarnessSessionReference,
  recordHarnessSessionReference,
} from "../../../packages/application/src/agents/harness-session-reference";
import {
  issueAgentCallbackCredential,
} from "../../../packages/application/src/agents/human-interaction";
import {
  SdkHarnessAdapter,
  type SdkEnvironment,
  type SdkHarnessAdapterOptions,
  type SdkRuntimeFactoryOptions,
  type SdkRuntime,
} from "../../../packages/harness-adapter/src/sdk-adapter";
import type { HarnessExecutionRequest } from "../../../packages/harness-adapter/src/types";
import { loadAgentExecutionRequest } from "../../../packages/queue/src/agent-dispatch";
import { createAgentOutboxHandler } from "./agent-worker";

export type ProductionHarnessConfig = {
  dshBin: string;
  dshHome: string;
  profile: string;
  patchPaths: string[];
  provider: string;
  model: string;
  pinnedHarnessVersion: string;
  allowedEnvironmentNames: string[];
  processEnv?: SdkEnvironment;
  allowDangerFullAccess?: boolean;
  callbackEndpoint: string;
  callbackSigningSecret: string;
  callbackTtlSeconds?: number;
  runtimeFactory?: (options: SdkRuntimeFactoryOptions) => SdkRuntime;
};

type CallbackCredential = {
  credentialRef: string;
  token: string;
  expiresAt: Date;
};

export type ProductionRuntimeServices = {
  issueCallbackCredential?: (
    sql: DatabaseSql,
    runId: string,
    signingSecret: string,
    ttlSeconds: number,
  ) => Promise<CallbackCredential>;
  recordSessionReference?: (
    sql: DatabaseSql,
    runId: string,
    sessionId: string,
    metadata: { runtimeProfile: string; harnessVersion: string },
  ) => Promise<unknown>;
  resolveSessionReference?: typeof getCurrentHarnessSessionReference;
  loadExecutionRequest?: (
    sql: DatabaseSql,
    runId: string,
  ) => Promise<HarnessExecutionRequest | null>;
};

function validateProductionHarnessConfig(config: ProductionHarnessConfig): void {
  if (!config.callbackEndpoint.trim()) {
    throw new Error("Agent callback endpoint is required");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(config.callbackEndpoint);
  } catch {
    throw new Error("Agent callback endpoint must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("Agent callback endpoint must use HTTP(S)");
  }
  if (!config.callbackSigningSecret.trim()) {
    throw new Error("Agent callback signing secret is required");
  }
  const ttl = config.callbackTtlSeconds ?? 900;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3600) {
    throw new Error("Agent callback credential TTL must be between 1 and 3600 seconds");
  }
}

export function createProductionHarnessAdapter(
  sql: DatabaseSql,
  config: ProductionHarnessConfig,
  services: ProductionRuntimeServices = {},
): SdkHarnessAdapter {
  validateProductionHarnessConfig(config);
  const issueCredential =
    services.issueCallbackCredential ?? issueAgentCallbackCredential;
  const recordReference =
    services.recordSessionReference ?? recordHarnessSessionReference;
  const resolveReference =
    services.resolveSessionReference ?? getCurrentHarnessSessionReference;
  const loadRequest =
    services.loadExecutionRequest ?? loadAgentExecutionRequest;
  const callbackTtlSeconds = config.callbackTtlSeconds ?? 900;

  const options: SdkHarnessAdapterOptions = {
    dshBin: config.dshBin,
    dshHome: config.dshHome,
    profile: config.profile,
    patchPaths: [...config.patchPaths],
    provider: config.provider,
    model: config.model,
    pinnedHarnessVersion: config.pinnedHarnessVersion,
    allowedEnvironmentNames: [...config.allowedEnvironmentNames],
    ...(config.processEnv ? { processEnv: config.processEnv } : {}),
    ...(config.allowDangerFullAccess === undefined
      ? {}
      : { allowDangerFullAccess: config.allowDangerFullAccess }),
    ...(config.runtimeFactory ? { runtimeFactory: config.runtimeFactory } : {}),
    async recordSessionReference(reference) {
      await recordReference(
        sql,
        reference.runId,
        reference.sessionId,
        {
          runtimeProfile: reference.runtimeProfile,
          harnessVersion: reference.harnessVersion,
        },
      );
    },
    async resolveSessionReference(runId) {
      const reference = await resolveReference(sql, runId);
      return reference
        ? {
            runId,
            sessionId: reference.sessionId,
            runtimeProfile: reference.runtimeProfile,
            harnessVersion: reference.harnessVersion,
            generation: reference.generation,
          }
        : null;
    },
    async loadExecutionRequest(runId) {
      return loadRequest(sql, runId);
    },
    async resolveHumanInteractionBridge(request) {
      const credential = await issueCredential(
        sql,
        request.runId,
        config.callbackSigningSecret,
        callbackTtlSeconds,
      );
      return {
        endpoint: config.callbackEndpoint,
        callbackToken: credential.token,
      };
    },
  };

  return new SdkHarnessAdapter(options);
}

export function createProductionAgentOutboxHandler(
  sql: DatabaseSql,
  config: ProductionHarnessConfig,
  services: ProductionRuntimeServices = {},
) {
  return createAgentOutboxHandler(
    sql,
    createProductionHarnessAdapter(sql, config, services),
  );
}
