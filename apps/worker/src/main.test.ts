import { describe, expect, it } from "vitest";
import type { ClaimedOutboxRecord } from "@research-workbench/queue/src/outbox-dispatcher";

describe("worker main composition", () => {
  it("keeps startWorker injectable and composes boolean handlers at the boundary", async () => {
    const modulePath = "./main";
    const main = await import(modulePath);
    expect(typeof main.startWorker).toBe("function");
    expect(typeof main.createWorkerDispatch).toBe("function");

    const calls: string[] = [];
    const first = async (record: ClaimedOutboxRecord) => {
      calls.push(`first:${record.eventType}`);
      return false;
    };
    const second = async (record: ClaimedOutboxRecord) => {
      calls.push(`second:${record.eventType}`);
      return record.eventType === "file.upload.completed";
    };

    const dispatch = main.createWorkerDispatch(first, second);
    await dispatch({
      id: "main-file-event",
      eventType: "file.upload.completed",
      payload: { uploadIntentId: "intent-main" },
      attempts: 1,
    });

    expect(calls).toEqual([
      "first:file.upload.completed",
      "second:file.upload.completed",
    ]);
  });
});
