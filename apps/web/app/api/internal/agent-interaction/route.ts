import {
  requestHumanInteraction,
  verifyAgentCallbackCredential,
  type HumanInteractionKind,
} from "@research-workbench/application/src/agents/human-interaction";
import type { JsonValue } from "@research-workbench/domain/src/events";
import { getWebDbClient } from "../../../../src/server/queries";

function signingSecret(): string {
  const value = process.env.AGENT_CALLBACK_SIGNING_SECRET?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: AGENT_CALLBACK_SIGNING_SECRET");
  }
  return value;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ status: "unavailable" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ status: "unavailable" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ status: "unavailable" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.runId !== "string" ||
    (record.kind !== "question" && record.kind !== "approval") ||
    typeof record.nonce !== "string" ||
    record.payload === undefined
  ) {
    return Response.json({ status: "unavailable" }, { status: 400 });
  }

  const db = getWebDbClient();
  try {
    const verified = await verifyAgentCallbackCredential(
      db.sql,
      token,
      signingSecret(),
      record.runId,
    );
    const reply = await requestHumanInteraction(db.sql, {
      runId: verified.runId,
      kind: record.kind as HumanInteractionKind,
      payload: record.payload as JsonValue,
      nonce: record.nonce,
      credentialRef: verified.credentialRef,
    });
    return Response.json(reply, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
