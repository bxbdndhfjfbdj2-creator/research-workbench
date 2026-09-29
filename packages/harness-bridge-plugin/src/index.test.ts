import { describe, expect, it, vi } from "vitest";
import { createBridgeHandlers } from "./index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Research Workbench Harness human bridge", () => {
  it("persists a user question, polls with the same nonce, and returns the human answer", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(url), init: init ?? {}, body });
        return jsonResponse({
          status: "pending",
          interactionId: "interaction-1",
        });
      })
      .mockImplementationOnce(async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(url), init: init ?? {}, body });
        return jsonResponse({
          status: "answered",
          interactionId: "interaction-1",
          answer: {
            answers: [{ id: "confirm", selected: ["继续"] }],
          },
        });
      });

    const handlers = createBridgeHandlers({
      runId: "run-bridge",
      endpoint: "https://workbench.internal/api/internal/agent-interaction",
      callbackToken: "callback-secret-token",
      fetchImpl,
      pollIntervalMs: 0,
      sleep: async () => {},
    });

    const answer = await handlers.question({
      questions: [
        {
          id: "confirm",
          question: "继续执行吗？",
          options: [{ label: "继续" }, { label: "停止" }],
        },
      ],
      agent: { id: "must-not-cross-http" },
      signal: new AbortController().signal,
    });

    expect(answer).toEqual({
      answers: [{ id: "confirm", selected: ["继续"] }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requests[0]?.body.nonce).toBe(requests[1]?.body.nonce);
    expect(requests[0]?.body).toMatchObject({
      runId: "run-bridge",
      kind: "question",
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("callback-secret-token");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("must-not-cross-http");
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer callback-secret-token",
      "content-type": "application/json",
    });
  });

  it("fails an approval closed when the Workbench bridge is unavailable", async () => {
    const handlers = createBridgeHandlers({
      runId: "run-bridge",
      endpoint: "https://workbench.internal/api/internal/agent-interaction",
      callbackToken: "callback-secret-token",
      fetchImpl: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      pollIntervalMs: 0,
      sleep: async () => {},
    });

    await expect(
      handlers.approval({
        toolName: "bash",
        callId: "call-1",
        reason: "requires execution approval",
      }),
    ).resolves.toBe("unavailable");
  });

  it("returns only one-shot approval vocabulary and never accepts a malformed grant", async () => {
    const allowed = createBridgeHandlers({
      runId: "run-bridge",
      endpoint: "https://workbench.internal/api/internal/agent-interaction",
      callbackToken: "callback-secret-token",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          status: "answered",
          interactionId: "interaction-approval",
          answer: "allowed-once",
        }),
      ),
      pollIntervalMs: 0,
      sleep: async () => {},
    });
    await expect(
      allowed.approval({ toolName: "write", reason: "write workspace file" }),
    ).resolves.toBe("allowed-once");

    const malformed = createBridgeHandlers({
      runId: "run-bridge",
      endpoint: "https://workbench.internal/api/internal/agent-interaction",
      callbackToken: "callback-secret-token",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          status: "answered",
          interactionId: "interaction-malformed",
          answer: "allow-always",
        }),
      ),
      pollIntervalMs: 0,
      sleep: async () => {},
    });
    await expect(
      malformed.approval({ toolName: "bash" }),
    ).resolves.toBe("unavailable");
  });

  it("fails a question closed rather than silently inventing an answer", async () => {
    const handlers = createBridgeHandlers({
      runId: "run-bridge",
      endpoint: "https://workbench.internal/api/internal/agent-interaction",
      callbackToken: "callback-secret-token",
      fetchImpl: vi.fn(async () => jsonResponse({ status: "unavailable" }, 503)),
      pollIntervalMs: 0,
      sleep: async () => {},
    });

    await expect(
      handlers.question({
        questions: [{ id: "q", question: "Need human input?" }],
      }),
    ).rejects.toThrow(/unavailable|Workbench|bridge/i);
  });
});
