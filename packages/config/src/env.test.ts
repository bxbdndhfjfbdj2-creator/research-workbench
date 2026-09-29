import { describe, expect, it } from "vitest";
import { loadConfig } from "./env";

describe("loadConfig", () => {
  it("rejects a missing DATABASE_URL without leaking other secret values", () => {
    const authSecret = "super-secret-auth-value";

    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        BETTER_AUTH_SECRET: authSecret,
      }),
    ).toThrow(/DATABASE_URL/);

    try {
      loadConfig({ NODE_ENV: "test", BETTER_AUTH_SECRET: authSecret });
    } catch (error) {
      expect(String(error)).not.toContain(authSecret);
    }
  });

  it("returns secret references instead of secret values", () => {
    const databaseUrl = "postgresql://user:database-secret@localhost/research";
    const authSecret = "auth-secret-value";

    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: authSecret,
    });

    expect(config).toEqual({
      nodeEnv: "test",
      databaseUrl: { source: "env", key: "DATABASE_URL" },
      betterAuthSecret: { source: "env", key: "BETTER_AUTH_SECRET" },
    });
    expect(JSON.stringify(config)).not.toContain(databaseUrl);
    expect(JSON.stringify(config)).not.toContain(authSecret);
  });
});
