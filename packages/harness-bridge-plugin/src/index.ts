import { randomUUID } from "node:crypto";

type QuestionRequest = {
  questions: unknown[];
  agent?: unknown;
  signal?: AbortSignal;
};

type ApprovalRequest = {
  toolName: string;
  callId?: string;
  reason?: string;
  agent?: unknown;
  signal?: AbortSignal;
};

type BridgeOptions = {
  runId: string;
  endpoint: string;
  callbackToken: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type BridgeReply =
  | { status: "pending"; interactionId: string }
  | { status: "answered"; interactionId: string; answer: unknown }
  | { status: "unavailable"; interactionId?: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBridgeHandlers(options: BridgeOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;
  const pollIntervalMs = options.pollIntervalMs ?? 750;

  async function exchange(
    kind: "question" | "approval",
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<BridgeReply> {
    const nonce = randomUUID();
    while (true) {
      if (signal?.aborted) {
        return { status: "unavailable" };
      }
      let response: Response;
      try {
        response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: {
            authorization: "Bearer " + options.callbackToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            runId: options.runId,
            kind,
            payload,
            nonce,
          }),
          signal,
        });
      } catch {
        return { status: "unavailable" };
      }
      if (!response.ok) return { status: "unavailable" };

      const body = (await response.json()) as BridgeReply;
      if (body.status === "answered" || body.status === "unavailable") return body;
      if (body.status !== "pending") return { status: "unavailable" };
      await sleep(pollIntervalMs);
    }
  }

  return {
    async question(request: QuestionRequest): Promise<unknown> {
      const reply = await exchange(
        "question",
        { questions: request.questions },
        request.signal,
      );
      if (reply.status !== "answered") {
        throw new Error("Workbench human-question bridge is unavailable");
      }
      return reply.answer;
    },

    async approval(request: ApprovalRequest): Promise<
      "allowed-once" | "rejected" | "cancelled" | "unavailable"
    > {
      const reply = await exchange(
        "approval",
        {
          toolName: request.toolName,
          ...(request.callId ? { callId: request.callId } : {}),
          ...(request.reason ? { reason: request.reason } : {}),
        },
        request.signal,
      );
      if (reply.status !== "answered") return "unavailable";
      return ["allowed-once", "rejected", "cancelled", "unavailable"].includes(
        String(reply.answer),
      )
        ? (reply.answer as "allowed-once" | "rejected" | "cancelled" | "unavailable")
        : "unavailable";
    },
  };
}

export const name = "research-workbench-human-bridge";
export const inject = ["userQuestions", "approval"];

export type Config = {
  runId: string;
  endpoint: string;
  callbackToken: string;
  pollIntervalMs?: number;
};

type CordisLikeContext = {
  on(event: string, handler: (request: any) => Promise<unknown>): unknown;
};

export function apply(ctx: CordisLikeContext, config: Config): void {
  const handlers = createBridgeHandlers({
    runId: config.runId,
    endpoint: config.endpoint,
    callbackToken: config.callbackToken,
    pollIntervalMs: config.pollIntervalMs,
  });
  ctx.on("user-questions/request", (request) =>
    handlers.question({
      questions: request.questions,
      signal: request.signal,
    }),
  );
  ctx.on("approval/request", (request) =>
    handlers.approval({
      toolName: request.toolName,
      callId: request.callId,
      reason: request.reason,
      signal: request.signal,
    }),
  );
}
