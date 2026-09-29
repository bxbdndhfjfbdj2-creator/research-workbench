import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import type {
  CreateResearchResultInput,
  ResearchResult,
} from "@research-workbench/domain/src/research-result";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

function validateGitLocator(input: CreateResearchResultInput): void {
  if (input.executionKind !== "code") return;
  if (!input.gitCommit) {
    throw new Error("Code research results require a Git commit locator");
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(input.gitCommit.repositoryFullName)) {
    throw new Error("Git repositoryFullName must be in owner/name form");
  }
  if (!/^[0-9a-f]{40,64}$/i.test(input.gitCommit.sha)) {
    throw new Error("Git commit SHA must be an immutable hexadecimal commit identifier");
  }
}

async function authorizeResultCreation(sql: DatabaseSql, projectId: string, actor: ActorRef) {
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "write");
    return;
  }
  const rows = await sql.unsafe("select 1 from research_projects where id = $1 limit 1", [projectId]);
  if (rows.length === 0) throw new Error("Research project not found");
}

export async function createResearchResult(
  sql: DatabaseSql,
  input: CreateResearchResultInput,
  actor: ActorRef,
): Promise<ResearchResult> {
  validateGitLocator(input);
  await authorizeResultCreation(sql, input.projectId, actor);

  const revisionRows = await sql.unsafe(
    `select 1
     from research_node_revisions r
     join research_nodes n on n.id = r.node_id
     where r.id = $1 and n.project_id = $2
     limit 1`,
    [input.analysisRevisionId, input.projectId],
  );
  if (revisionRows.length === 0) {
    throw new Error("Analysis revision does not belong to the research project");
  }

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into research_results
        (id, project_id, data_version_ref, analysis_revision_id, execution_kind,
         run_ref, output_refs, git_repository_full_name, git_commit_sha,
         created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       returning *`,
      [
        id,
        input.projectId,
        input.dataVersionRef,
        input.analysisRevisionId,
        input.executionKind,
        input.runRef,
        JSON.stringify(input.outputRefs),
        input.gitCommit?.repositoryFullName ?? null,
        input.gitCommit?.sha ?? null,
        actor.type,
        actor.id,
      ],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: input.projectId,
      eventType: "RESEARCH_RESULT_CREATED",
      actor,
      payload: {
        resultId: id,
        dataVersionRef: input.dataVersionRef,
        analysisRevisionId: input.analysisRevisionId,
        executionKind: input.executionKind,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.result.created",
      payload: { projectId: input.projectId, resultId: id },
    });

    const row = rows[0];
    if (!row) throw new Error("Research result insert returned no row");
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      dataVersionRef: String(row.data_version_ref),
      analysisRevisionId: String(row.analysis_revision_id),
      executionKind: row.execution_kind as ResearchResult["executionKind"],
      runRef: String(row.run_ref),
      outputRefs: row.output_refs as string[],
      gitCommit:
        row.git_repository_full_name && row.git_commit_sha
          ? {
              repositoryFullName: String(row.git_repository_full_name),
              sha: String(row.git_commit_sha),
            }
          : undefined,
      createdBy: { type: row.created_by_type as ActorRef["type"], id: String(row.created_by_id) },
      createdAt: row.created_at as Date,
    };
  });
}

export async function supersedeResearchResult(
  sql: DatabaseSql,
  newResultId: string,
  oldResultId: string,
  actor: ActorRef,
): Promise<void> {
  if (actor.type !== "human") {
    throw new Error("Superseding a formal research result requires a human actor");
  }
  if (newResultId === oldResultId) throw new Error("A research result cannot supersede itself");

  const rows = await sql.unsafe(
    `select id, project_id
     from research_results
     where id = any($1::text[])
     order by id`,
    [[newResultId, oldResultId]],
  );
  if (rows.length !== 2) throw new Error("Both research results must exist");
  const projects = new Set(rows.map((row) => String(row.project_id)));
  if (projects.size !== 1) throw new Error("Research result supersession cannot cross projects");
  const projectId = String(rows[0]?.project_id);
  await authorizeProjectAccess(sql, actor.id, projectId, "write");

  await runInTransaction(sql, async (tx) => {
    await tx.unsafe(
      `insert into research_result_supersessions
        (id, project_id, new_result_id, old_result_id, actor_type, actor_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), projectId, newResultId, oldResultId, actor.type, actor.id],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_RESULT_SUPERSEDED",
      actor,
      payload: { newResultId, oldResultId },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.result.superseded",
      payload: { projectId, newResultId, oldResultId },
    });
  });
}
