import { describe, expect, it } from "vitest";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ClaimedOutboxRecord } from "@research-workbench/queue/src/outbox-dispatcher";

describe("production file runtime composition", () => {
  it("dispatches each owned event to exactly one handler and preserves agent dispatch", async () => {
    const modulePath = "./file-runtime";
    const runtime = await import(modulePath);
    const calls: string[] = [];

    const fileHandler = async (record: ClaimedOutboxRecord) => {
      calls.push(`file:${record.eventType}`);
      return record.eventType === "file.upload.completed";
    };
    const agentHandler = async (record: ClaimedOutboxRecord) => {
      calls.push(`agent:${record.eventType}`);
      return record.eventType === "agent.run.dispatch";
    };

    const dispatch = runtime.composeOutboxHandlers(fileHandler, agentHandler);
    await dispatch({
      id: "file-event",
      eventType: "file.upload.completed",
      payload: { uploadIntentId: "intent-1" },
      attempts: 1,
    });
    expect(calls).toEqual(["file:file.upload.completed"]);

    calls.length = 0;
    await dispatch({
      id: "agent-event",
      eventType: "agent.run.dispatch",
      payload: { agentRunId: "run-1" },
      attempts: 1,
    });
    expect(calls).toEqual([
      "file:agent.run.dispatch",
      "agent:agent.run.dispatch",
    ]);
  });

  it("fails closed on an unowned outbox event without leaking its payload", async () => {
    const modulePath = "./file-runtime";
    const runtime = await import(modulePath);
    const dispatch = runtime.composeOutboxHandlers(async () => false);

    await expect(
      dispatch({
        id: "unknown-event",
        eventType: "unknown.secret.event",
        payload: { token: "do-not-leak-this-value" },
        attempts: 1,
      }),
    ).rejects.toMatchObject({ name: "UnhandledOutboxEvent" });

    try {
      await dispatch({
        id: "unknown-event-2",
        eventType: "unknown.secret.event",
        payload: { token: "do-not-leak-this-value" },
        attempts: 1,
      });
    } catch (error) {
      expect(String(error)).toContain("unknown.secret.event");
      expect(String(error)).not.toContain("do-not-leak-this-value");
    }
  });

  it("rejects clearly public processor endpoints before constructing adapters", async () => {
    const modulePath = "./file-runtime";
    const runtime = await import(modulePath);
    const baseConfig = {
      s3Endpoint: "http://seaweedfs:8333",
      s3Region: "us-east-1",
      s3ForcePathStyle: true,
      quarantineBucket: "rw-quarantine",
      readyBucket: "rw-ready",
      readyPrefix: "ready/",
      derivedPrefix: "derived/",
      clamavEndpoint: { host: "clamav", port: 3310 },
      tikaBaseUrl: "http://tika:9998",
      doclingBaseUrl: "http://docling:5001",
      maxFileBytes: 1024 * 1024,
      maxExtractedSearchBytes: 4096,
    } satisfies import("./file-runtime").FileRuntimeConfig;

    const secrets = {
      s3AccessKeyId: "storage-access-secret",
      s3SecretAccessKey: "storage-secret",
    };

    expect(() =>
      runtime.createProductionFileOutboxHandler(
        {} as DatabaseSql,
        { ...baseConfig, tikaBaseUrl: "https://example.com" },
        secrets,
      ),
    ).toThrow(/private|Tika/i);

    expect(() =>
      runtime.createProductionFileOutboxHandler(
        {} as DatabaseSql,
        { ...baseConfig, s3Endpoint: "https://s3.example.com" },
        secrets,
      ),
    ).toThrow(/private|S3/i);

    expect(() =>
      runtime.createProductionFileOutboxHandler(
        {} as DatabaseSql,
        { ...baseConfig, clamavEndpoint: { host: "8.8.8.8", port: 3310 } },
        secrets,
      ),
    ).toThrow(/private|ClamAV/i);
  });
});
