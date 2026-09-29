import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { HarnessSessionReference } from "@research-workbench/domain/src/agent-runtime";
import { assertSecretSafe, type JsonValue } from "@research-workbench/domain/src/events";
import { appendResearchEvent } from "../events/append-research-event";
import { runInTransaction } from "../transactions";

type SessionMetadata = {
  runtimeProfile: string;
  harnessVersion: string;
};

type SessionRow = {
  id: string;
  run_id: string;
  session_id: string;
  runtime_profile: string;
  harness_version: string;
  generation: number;
  created_at: Date;
};

function toReference(row: SessionRow): HarnessSessionReference {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    runtimeProfile: row.runtime_profile,
    harnessVersion: row.harness_version,
    generation: row.generation,
    createdAt: row.created_at,
  };
}

export async function recordHarnessSessionReference(
  sql: DatabaseSql,
  runId: string,
  sessionId: string,
  metadata: SessionMetadata,
): Promise<HarnessSessionReference> {
  assertSecretSafe(metadata as unknown as JsonValue);
  if (!sessionId.trim()) throw new Error("Harness session id is required");

  return runInTransaction(sql, async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))", [runId]);

    const runRows = await tx.unsafe(
      "select project_id, execution_policy from agent_runs where id = $1 limit 1",
      [runId],
    );
    const run = runRows[0];
    if (!run) throw new Error("Agent run not found");

    const executionPolicy = run.execution_policy as Record<string, unknown>;
    if (executionPolicy.runtimeProfile !== metadata.runtimeProfile) {
      throw new Error("Harness runtime profile differs from the AgentRun policy");
    }
    if (executionPolicy.harnessVersion !== metadata.harnessVersion) {
      throw new Error("Harness version differs from the AgentRun policy");
    }

    const generationRows = await tx.unsafe(
      "select coalesce(max(generation), 0)::int + 1 as next_generation from harness_session_references where run_id = $1",
      [runId],
    );
    const generation = Number(generationRows[0]?.next_generation ?? 1);
    const id = randomUUID();

    const rows = (await tx.unsafe(
      `insert into harness_session_references
        (id, run_id, session_id, runtime_profile, harness_version, generation)
       values ($1, $2, $3, $4, $5, $6)
       returning id, run_id, session_id, runtime_profile, harness_version,
                 generation, created_at`,
      [
        id,
        runId,
        sessionId,
        metadata.runtimeProfile,
        metadata.harnessVersion,
        generation,
      ],
    )) as readonly SessionRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: String(run.project_id),
      eventType: "HARNESS_SESSION_REFERENCED",
      actor: { type: "system", id: "harness-adapter" },
      payload: {
        agentRunId: runId,
        sessionId,
        runtimeProfile: metadata.runtimeProfile,
        harnessVersion: metadata.harnessVersion,
        generation,
      },
    });

    const row = rows[0];
    if (!row) throw new Error("Harness session reference insert returned no row");
    return toReference(row);
  });
}

export async function getCurrentHarnessSessionReference(
  sql: DatabaseSql,
  runId: string,
): Promise<HarnessSessionReference | null> {
  const rows = (await sql.unsafe(
    `select id, run_id, session_id, runtime_profile, harness_version,
            generation, created_at
     from harness_session_references
     where run_id = $1
     order by generation desc
     limit 1`,
    [runId],
  )) as readonly SessionRow[];
  const row = rows[0];
  return row ? toReference(row) : null;
}
