export type SecretRef = {
  source: "env";
  key: string;
};

export type AppConfig = {
  nodeEnv: string;
  databaseUrl: SecretRef;
  betterAuthSecret: SecretRef;
};

export function loadConfig(_env: NodeJS.ProcessEnv): AppConfig {
  throw new Error("loadConfig not implemented");
}
