import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import { assertSecretSafe, type JsonValue } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { runInTransaction } from "../transactions";

export type HumanInteractionKind = "question" | "approval";
export type HumanInteractionResponse =
  | { status: "pending"; interactionId: string }
  | { status: "answered"; interactionId: string; answer: JsonValue };

type CallbackTokenPayload = {
  credentialRef: string;
  runId: string;
  exp: number;
};

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function parseSignedToken(token: string, secret: string): CallbackTokenPayload {
  const [encoded, suppliedSignature] = token.split(".");
  if (!encoded || !suppliedSignature) {
    throw new Error("Invalid callback credential token");
  }
  const expectedSignature = sign(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid callback credential signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid callback credential token payload");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).credentialRef !== "string" ||
    typeof (parsed as Record<string, unknown>).runId !== "string" ||
    typeof (parsed as Record<string, unknown>).exp !== "number"
  ) {
    throw new Error("Invalid callback credential token payload");
  }
  return parsed as CallbackTokenPayload;
}

export async function issueAgentCallbackCredential(
  sql: DatabaseSql,
  runId: string,
  signingSecret: string,
  ttlSeconds: number,
): Promise<{ credentialRef: string; token: string; expiresAt: Date }> {
  if (!signingSecret.trim()) throw new Error("Callback signing secret is required");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Callback credential TTL must be a positive integer");
  }

  const runRows = await sql.unsafe(
    "select project_id from agent_runs where id = $1 limit 1",
    [runId],
  );
  const run = runRows[0];
  if (!run) throw new Error("Agent run not found");

  const credentialRef = randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload: CallbackTokenPayload = {
    credentialRef,
    runId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encoded = b64url(JSON.stringify(payload));
  const token = encoded + "." + sign(encoded, signingSecret);

  await runInTransaction(sql, async (tx) => {
    await tx.unsafe(
      `insert into agent_callback_credentials
        (id, run_id, expires_at)
       values ($1, $2, $3)`,
      [credentialRef, runId, expiresAt],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: String(run.project_id),
      eventType: "AGENT_CALLBACK_CREDENTIAL_ISSUED",
      actor: { type: "system", id: "workbench-callback-issuer" },
      payload: { agentRunId: runId, credentialRef, expiresAt: expiresAt.toISOString() },
    });
  });

  return { credentialRef, token, expiresAt };
}

export async function verifyAgentCallbackCredential(
  sql: DatabaseSql,
  token: string,
  signingSecret: string,
  expectedRunId?: string,
): Promise<{ runId: string; credentialRef: string }> {
  const payload = parseSignedToken(token, signingSecret);
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Callback credential token has expired");
  }
  if (expectedRunId && payload.runId !== expectedRunId) {
    throw new Error("Callback credential token belongs to another run");
  }

  const rows = await sql.unsafe(
    `select id, run_id, expires_at, revoked_at
     from agent_callback_credentials
     where id = $1 and run_id = $2
     limit 1`,
    [payload.credentialRef, payload.runId],
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at as Date).getTime() <= Date.now()) {
    throw new Error("Callback credential is invalid or expired");
  }

  return { runId: payload.runId, credentialRef: payload.credentialRef };
}

function validateInteractionAnswer(
  kind: HumanInteractionKind,
  answer: JsonValue,
): void {
  assertSecretSafe(answer);
  if (kind === "approval") {
    if (!["allowed-once", "rejected", "cancelled", "unavailable"].includes(String(answer))) {
      throw new Error("Approval answer must use one-shot approval vocabulary");
    }
  }
}

export async function requestHumanInteraction(
  sql: DatabaseSql,
  input: {
    runId: string;
    kind: HumanInteractionKind;
    payload: JsonValue;
    nonce: string;
    credentialRef: string;
  },
): Promise<HumanInteractionResponse> {
  assertSecretSafe(input.payload);
  if (!input.nonce.trim()) throw new Error("Interaction nonce is required");

  return runInTransaction(sql, async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))", [
      input.runId + ":" + input.nonce,
    ]);

    const existing = await tx.unsafe(
      `select id, kind, payload, state, answer
       from agent_human_interactions
       where run_id = $1 and nonce = $2
       limit 1`,
      [input.runId, input.nonce],
    );
    const prior = existing[0];
    if (prior) {
      if (String(prior.kind) !== input.kind || JSON.stringify(prior.payload) !== JSON.stringify(input.payload)) {
        throw new Error("Interaction nonce was reused with different content");
      }
      if (prior.state === "answered") {
        return {
          status: "answered" as const,
          interactionId: String(prior.id),
          answer: prior.answer as JsonValue,
        };
      }
      return {
        status: "pending" as const,
        interactionId: String(prior.id),
      };
    }

    const runRows = await tx.unsafe(
      `select r.project_id, r.state
       from agent_runs r
       join agent_callback_credentials c
         on c.id = $2 and c.run_id = r.id
       where r.id = $1
         and c.revoked_at is null
         and c.expires_at > now()
       limit 1`,
      [input.runId, input.credentialRef],
    );
    const run = runRows[0];
    if (!run) throw new Error("Callback credential is unavailable for this run");

    const state = String(run.state);
    if (!["执行中", "继续执行", "等待人工输入"].includes(state)) {
      throw new Error("Agent run is not in a state that can request human interaction");
    }

    const id = randomUUID();
    await tx.unsafe(
      `insert into agent_human_interactions
        (id, run_id, kind, payload, nonce, credential_ref, state)
       values ($1, $2, $3, $4::jsonb, $5, $6, 'pending')`,
      [
        id,
        input.runId,
        input.kind,
        JSON.stringify(input.payload),
        input.nonce,
        input.credentialRef,
      ],
    );

    if (state !== "等待人工输入") {
      await tx.unsafe(
        "update agent_runs set state = '等待人工输入', updated_at = now() where id = $1",
        [input.runId],
      );
    }
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: String(run.project_id),
      eventType: "AGENT_RUN_WAITING_HUMAN",
      actor: { type: "system", id: "harness-human-bridge" },
      payload: {
        agentRunId: input.runId,
        interactionId: id,
        kind: input.kind,
        nonce: input.nonce,
      },
    });

    return { status: "pending" as const, interactionId: id };
  });
}

export async function answerHumanInteraction(
  sql: DatabaseSql,
  interactionId: string,
  answer: JsonValue,
  actor: ActorRef,
): Promise<void> {
  return runInTransaction(sql, async (tx) => {
    const rows = await tx.unsafe(
      `select i.run_id, i.kind, i.state, r.project_id
       from agent_human_interactions i
       join agent_runs r on r.id = i.run_id
       where i.id = $1
       for update`,
      [interactionId],
    );
    const interaction = rows[0];
    if (!interaction) throw new Error("Human interaction not found");
    if (interaction.state !== "pending") {
      throw new Error("Human interaction was already answered");
    }
    if (actor.type !== "human") {
      throw new Error("Only a human may answer a pending Agent interaction");
    }

    await authorizeProjectAccess(tx, actor.id, String(interaction.project_id), "read");
    validateInteractionAnswer(interaction.kind as HumanInteractionKind, answer);

    const updated = await tx.unsafe(
      `update agent_human_interactions
       set state = 'answered',
           answer = $2::jsonb,
           answered_by_member_id = $3,
           answered_at = now()
       where id = $1 and state = 'pending'
       returning run_id`,
      [interactionId, JSON.stringify(answer), actor.id],
    );
    if (updated.length !== 1) throw new Error("Human interaction was already answered");

    await tx.unsafe(
      `update agent_runs
       set state = '执行中', updated_at = now()
       where id = $1 and state = '等待人工输入'`,
      [String(interaction.run_id)],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: String(interaction.project_id),
      eventType: "AGENT_HUMAN_INTERACTION_ANSWERED",
      actor,
      payload: {
        agentRunId: String(interaction.run_id),
        interactionId,
        kind: String(interaction.kind),
      },
    });
  });
}
