import { betterAuth } from "better-auth";
import { Pool } from "pg";

export type WorkbenchAuthOptions = {
  emailAndPassword: {
    enabled: true;
    disableSignUp: true;
  };
};

export function createWorkbenchAuthOptions(): WorkbenchAuthOptions {
  return {
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
  };
}

export function createWorkbenchAuth(databaseUrl: string, secret: string) {
  return betterAuth({
    database: new Pool({ connectionString: databaseUrl }),
    secret,
    emailAndPassword: createWorkbenchAuthOptions().emailAndPassword,
  });
}

function requireRuntimeSecret(key: "DATABASE_URL" | "BETTER_AUTH_SECRET"): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const auth =
  process.env.NODE_ENV === "test"
    ? null
    : createWorkbenchAuth(
        requireRuntimeSecret("DATABASE_URL"),
        requireRuntimeSecret("BETTER_AUTH_SECRET"),
      );
