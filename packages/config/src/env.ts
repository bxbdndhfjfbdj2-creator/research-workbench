export type SecretRef = {
  source: "env";
  key: string;
};

export type AppConfig = {
  nodeEnv: string;
  databaseUrl: SecretRef;
  betterAuthSecret: SecretRef;
};

function requireEnv(env: NodeJS.ProcessEnv, key: string): void {
  if (!env[key]?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  requireEnv(env, "DATABASE_URL");
  requireEnv(env, "BETTER_AUTH_SECRET");

  return {
    nodeEnv: env.NODE_ENV?.trim() || "development",
    databaseUrl: { source: "env", key: "DATABASE_URL" },
    betterAuthSecret: { source: "env", key: "BETTER_AUTH_SECRET" },
  };
}


export type FileUploadConfig = {
  uploadSigningSecret: SecretRef;
  storageAccessKeyId: SecretRef;
  storageSecretAccessKey: SecretRef;
  tusEndpoint: string;
  quarantineBucket: string;
  quarantinePrefix: string;
  maxFileBytes: number;
  uploadHookTtlSeconds: number;
};

function requireTextEnv(env: NodeJS.ProcessEnv, key: string): string {
  requireEnv(env, key);
  return env[key]!.trim();
}

function requirePositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  maximum?: number,
): number {
  const raw = requireTextEnv(env, key);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    throw new Error(`Invalid ${key}: expected a positive integer${maximum ? ` <= ${maximum}` : ""}`);
  }
  return value;
}

export function loadFileUploadConfig(env: NodeJS.ProcessEnv): FileUploadConfig {
  const tusEndpoint = requireTextEnv(env, "TUS_ENDPOINT");
  let parsedTusEndpoint: URL;
  try {
    parsedTusEndpoint = new URL(tusEndpoint);
  } catch {
    throw new Error("Invalid TUS_ENDPOINT: expected an HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsedTusEndpoint.protocol)) {
    throw new Error("Invalid TUS_ENDPOINT: expected an HTTP(S) URL");
  }

  const quarantinePrefix = requireTextEnv(env, "FILE_QUARANTINE_PREFIX");
  if (quarantinePrefix.startsWith("/") || !quarantinePrefix.endsWith("/")) {
    throw new Error("Invalid FILE_QUARANTINE_PREFIX: expected a relative prefix ending in /");
  }

  return {
    uploadSigningSecret: { source: "env", key: "FILE_UPLOAD_SIGNING_SECRET" },
    storageAccessKeyId: { source: "env", key: "FILE_STORAGE_ACCESS_KEY_ID" },
    storageSecretAccessKey: { source: "env", key: "FILE_STORAGE_SECRET_ACCESS_KEY" },
    tusEndpoint,
    quarantineBucket: requireTextEnv(env, "FILE_QUARANTINE_BUCKET"),
    quarantinePrefix,
    maxFileBytes: requirePositiveIntegerEnv(env, "FILE_MAX_BYTES"),
    uploadHookTtlSeconds: requirePositiveIntegerEnv(
      env,
      "FILE_UPLOAD_HOOK_TTL_SECONDS",
      86_400,
    ),
  };
}
