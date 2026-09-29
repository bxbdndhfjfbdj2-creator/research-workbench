import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type {
  AgentContextSnapshot,
  AgentContextSnapshotInput,
} from "@research-workbench/domain/src/agent-runtime";
import { assertSecretSafe, type JsonValue } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";

async function assertRevisionBelongsToProject(
  sql: DatabaseSql,
  projectId: string,
  revisionId: string | null,
  label: string,
): Promise<void> {
  if (!revisionId) return;
  const rows = await sql.unsafe(
    `select 1
     from research_node_revisions r
     join research_nodes n on n.id = r.node_id
     where r.id = $1 and n.project_id = $2
     limit 1`,
    [revisionId, projectId],
  );
  if (rows.length === 0) {
    throw new Error(`${label} revision does not belong to the project`);
  }
}

export async function buildAgentContextSnapshot(
  sql: DatabaseSql,
  projectId: string,
  input: AgentContextSnapshotInput,
  actor: ActorRef,
): Promise<AgentContextSnapshot> {
  assertSecretSafe(input as unknown as JsonValue);

  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "read");
  } else if (actor.type === "agent") {
    throw new Error("Agent actors cannot freeze execution context directly");
  }

  await assertRevisionBelongsToProject(sql, projectId, input.researchQuestionRevisionId, "Research question");
  await assertRevisionBelongsToProject(sql, projectId, input.theoryRevisionId, "Theory");
  await assertRevisionBelongsToProject(sql, projectId, input.researchDesignRevisionId, "Research design");

  const id = randomUUID();
  const rows = await sql.unsafe(
    `insert into agent_context_snapshots
      (id, project_id, research_question_revision_id, theory_revision_id,
       research_design_revision_id, data_version_ref, asset_version_refs,
       git_base_commit, skill_version_refs, harness_version, harness_profile,
       runtime_profile, model_route, sandbox_policy, tool_allowlist,
       subagent_allowlist, execution_metadata, created_by_type, created_by_id)
     values
      ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11,
       $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19)
     returning created_at`,
    [
      id,
      projectId,
      input.researchQuestionRevisionId,
      input.theoryRevisionId,
      input.researchDesignRevisionId,
      input.dataVersionRef,
      JSON.stringify(input.assetVersionRefs),
      input.gitBaseCommit,
      JSON.stringify(input.skillVersionRefs),
      input.harnessVersion,
      input.harnessProfile,
      input.runtimeProfile,
      input.modelRoute,
      input.sandboxPolicy,
      JSON.stringify(input.toolAllowlist),
      JSON.stringify(input.subagentAllowlist),
      JSON.stringify(input.executionMetadata ?? null),
      actor.type,
      actor.id,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Agent context snapshot insert returned no row");
  return {
    id,
    projectId,
    ...input,
    createdBy: actor,
    createdAt: row.created_at as Date,
  };
}
