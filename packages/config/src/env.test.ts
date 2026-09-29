import { describe, expect, it } from "vitest";
import { loadConfig, loadFileUploadConfig } from "./env";

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


describe("loadFileUploadConfig", () => {
  it("returns secret references and validated non-secret upload settings", () => {
    const config = loadFileUploadConfig({
      FILE_UPLOAD_SIGNING_SECRET: "upload-signing-secret",
      FILE_STORAGE_ACCESS_KEY_ID: "storage-access",
      FILE_STORAGE_SECRET_ACCESS_KEY: "storage-secret",
      TUS_ENDPOINT: "http://tusd:8080/files/",
      FILE_QUARANTINE_BUCKET: "rw-quarantine",
      FILE_QUARANTINE_PREFIX: "uploads/",
      FILE_MAX_BYTES: "1048576",
      FILE_UPLOAD_HOOK_TTL_SECONDS: "900",
    });

    expect(config).toEqual({
      uploadSigningSecret: { source: "env", key: "FILE_UPLOAD_SIGNING_SECRET" },
      storageAccessKeyId: { source: "env", key: "FILE_STORAGE_ACCESS_KEY_ID" },
      storageSecretAccessKey: { source: "env", key: "FILE_STORAGE_SECRET_ACCESS_KEY" },
      tusEndpoint: "http://tusd:8080/files/",
      quarantineBucket: "rw-quarantine",
      quarantinePrefix: "uploads/",
      maxFileBytes: 1048576,
      uploadHookTtlSeconds: 900,
    });
    expect(JSON.stringify(config)).not.toContain("upload-signing-secret");
    expect(JSON.stringify(config)).not.toContain("storage-secret");
  });

  it("rejects invalid file upload limits and endpoints", () => {
    const base = {
      FILE_UPLOAD_SIGNING_SECRET: "upload-signing-secret",
      FILE_STORAGE_ACCESS_KEY_ID: "storage-access",
      FILE_STORAGE_SECRET_ACCESS_KEY: "storage-secret",
      TUS_ENDPOINT: "http://tusd:8080/files/",
      FILE_QUARANTINE_BUCKET: "rw-quarantine",
      FILE_QUARANTINE_PREFIX: "uploads/",
      FILE_MAX_BYTES: "1048576",
      FILE_UPLOAD_HOOK_TTL_SECONDS: "900",
    };

    expect(() => loadFileUploadConfig({ ...base, FILE_MAX_BYTES: "0" })).toThrow(/FILE_MAX_BYTES/);
    expect(() => loadFileUploadConfig({ ...base, FILE_UPLOAD_HOOK_TTL_SECONDS: "90000" })).toThrow(/TTL|FILE_UPLOAD_HOOK_TTL_SECONDS/);
    expect(() => loadFileUploadConfig({ ...base, TUS_ENDPOINT: "ftp://tusd/files" })).toThrow(/TUS_ENDPOINT/);
  });
});
