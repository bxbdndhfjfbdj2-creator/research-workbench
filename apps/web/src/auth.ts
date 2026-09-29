import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

export type WorkbenchAuthOptions = {
  emailAndPassword: {
    enabled: true;
    disableSignUp: boolean;
  };
};

export function createWorkbenchAuthOptions(
  allowAdministrativeBootstrap = false,
): WorkbenchAuthOptions {
  return {
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowAdministrativeBootstrap,
    },
  };
}

export function createWorkbenchAuth(
  databaseUrl: string,
  secret: string,
  options: { allowAdministrativeBootstrap?: boolean } = {},
) {
  return betterAuth({
    database: new Pool({ connectionString: databaseUrl }),
    secret,
    emailAndPassword: createWorkbenchAuthOptions(
      options.allowAdministrativeBootstrap ?? false,
    ).emailAndPassword,
  });
}

export async function migrateWorkbenchAuth(
  authInstance: ReturnType<typeof createWorkbenchAuth>,
): Promise<void> {
  const { runMigrations } = await getMigrations(authInstance.options);
  await runMigrations();
}

function requireRuntimeSecret(key: "DATABASE_URL" | "BETTER_AUTH_SECRET"): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

let runtimeAuth: ReturnType<typeof createWorkbenchAuth> | undefined;

export function getWorkbenchAuth() {
  runtimeAuth ??= createWorkbenchAuth(
    requireRuntimeSecret("DATABASE_URL"),
    requireRuntimeSecret("BETTER_AUTH_SECRET"),
  );
  return runtimeAuth;
}
