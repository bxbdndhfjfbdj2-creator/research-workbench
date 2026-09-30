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


export type FileProcessingConfig = {
  storageAccessKeyId: SecretRef;
  storageSecretAccessKey: SecretRef;
  s3Endpoint: string;
  s3Region: string;
  s3ForcePathStyle: boolean;
  quarantineBucket: string;
  readyBucket: string;
  readyPrefix: string;
  derivedPrefix: string;
  clamavEndpoint: { socketPath: string } | { host: string; port: number };
  tikaBaseUrl: string;
  doclingBaseUrl: string;
  maxFileBytes: number;
  maxExtractedSearchBytes: number;
};

function requireBooleanEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = requireTextEnv(env, key).toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid ${key}: expected true or false`);
}

function requireRelativePrefixEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = requireTextEnv(env, key);
  if (value.startsWith("/") || !value.endsWith("/")) {
    throw new Error(`Invalid ${key}: expected a relative prefix ending in /`);
  }
  return value;
}

function loadClamAvEndpoint(
  env: NodeJS.ProcessEnv,
): { socketPath: string } | { host: string; port: number } {
  const socketPath = env.FILE_CLAMAV_SOCKET_PATH?.trim();
  if (socketPath) return { socketPath };
  return {
    host: requireTextEnv(env, "FILE_CLAMAV_HOST"),
    port: requirePositiveIntegerEnv(env, "FILE_CLAMAV_PORT", 65_535),
  };
}

export function loadFileProcessingConfig(
  env: NodeJS.ProcessEnv,
): FileProcessingConfig {
  requireEnv(env, "FILE_STORAGE_ACCESS_KEY_ID");
  requireEnv(env, "FILE_STORAGE_SECRET_ACCESS_KEY");

  return {
    storageAccessKeyId: { source: "env", key: "FILE_STORAGE_ACCESS_KEY_ID" },
    storageSecretAccessKey: {
      source: "env",
      key: "FILE_STORAGE_SECRET_ACCESS_KEY",
    },
    s3Endpoint: requireTextEnv(env, "FILE_S3_ENDPOINT"),
    s3Region: requireTextEnv(env, "FILE_S3_REGION"),
    s3ForcePathStyle: requireBooleanEnv(env, "FILE_S3_FORCE_PATH_STYLE"),
    quarantineBucket: requireTextEnv(env, "FILE_QUARANTINE_BUCKET"),
    readyBucket: requireTextEnv(env, "FILE_READY_BUCKET"),
    readyPrefix: requireRelativePrefixEnv(env, "FILE_READY_PREFIX"),
    derivedPrefix: requireRelativePrefixEnv(env, "FILE_DERIVED_PREFIX"),
    clamavEndpoint: loadClamAvEndpoint(env),
    tikaBaseUrl: requireTextEnv(env, "FILE_TIKA_BASE_URL"),
    doclingBaseUrl: requireTextEnv(env, "FILE_DOCLING_BASE_URL"),
    maxFileBytes: requirePositiveIntegerEnv(env, "FILE_MAX_BYTES"),
    maxExtractedSearchBytes: requirePositiveIntegerEnv(
      env,
      "FILE_MAX_EXTRACTED_SEARCH_BYTES",
    ),
  };
}
