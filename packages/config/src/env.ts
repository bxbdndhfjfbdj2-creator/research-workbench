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
