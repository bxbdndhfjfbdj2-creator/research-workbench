import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import {
  FILE_LINK_RELATIONS,
  FILE_LINK_SUBJECT_TYPES,
  type FileLink,
  type FileLinkRelation,
  type FileLinkSubjectType,
} from "@research-workbench/domain/src/research-file";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction } from "../transactions";

type FileLinkRow = {
  id: string;
  file_version_id: string;
  subject_type: FileLinkSubjectType;
  subject_id: string;
  relation: FileLinkRelation;
  created_by_type: "human" | "agent" | "system";
  created_by_id: string;
  created_at: Date;
};

type RetirementRow = {
  id: string;
  file_link_id: string;
  reason: string;
  created_at: Date;
};

function toFileLink(row: FileLinkRow): FileLink {
  return {
    id: row.id,
    fileVersionId: row.file_version_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    relation: row.relation,
    createdByType: row.created_by_type,
    createdById: row.created_by_id,
    createdAt: row.created_at,
  };
}

function assertSubjectType(value: string): asserts value is FileLinkSubjectType {
  if (!(FILE_LINK_SUBJECT_TYPES as readonly string[]).includes(value)) {
    throw new Error("Unsupported file link subject type");
  }
}

function assertRelation(value: string): asserts value is FileLinkRelation {
  if (!(FILE_LINK_RELATIONS as readonly string[]).includes(value)) {
    throw new Error("Unsupported file link relation");
  }
}

async function loadFileProject(sql: DatabaseSql, fileVersionId: string): Promise<string> {
  const rows = await sql.unsafe(
    `select rf.project_id
     from file_versions fv
     join research_files rf on rf.id = fv.research_file_id
     where fv.id = $1
     limit 1`,
    [fileVersionId],
  );
  const row = rows[0];
  if (!row) throw new Error("File version not found");
  return String(row.project_id);
}

async function assertSubjectInProject(
  sql: DatabaseSql,
  projectId: string,
  subjectType: FileLinkSubjectType,
  subjectId: string,
): Promise<void> {
  let rows: readonly Record<string, unknown>[];

  switch (subjectType) {
    case "project":
      rows = await sql.unsafe(
        "select 1 from research_projects where id = $1 and id = $2 limit 1",
        [subjectId, projectId],
      );
      break;
    case "research_node_revision":
      rows = await sql.unsafe(
        `select 1
         from research_node_revisions r
         join research_nodes n on n.id = r.node_id
         where r.id = $1 and n.project_id = $2
         limit 1`,
        [subjectId, projectId],
      );
      break;
    case "research_task":
      rows = await sql.unsafe(
        "select 1 from research_tasks where id = $1 and project_id = $2 limit 1",
        [subjectId, projectId],
      );
      break;
    case "research_result":
      rows = await sql.unsafe(
        "select 1 from research_results where id = $1 and project_id = $2 limit 1",
        [subjectId, projectId],
      );
      break;
    case "scientific_decision":
      rows = await sql.unsafe(
        "select 1 from scientific_decisions where id = $1 and project_id = $2 limit 1",
        [subjectId, projectId],
      );
      break;
    case "data_version":
      rows = await sql.unsafe(
        `select 1
         where exists (
           select 1 from research_results
           where project_id = $1 and data_version_ref = $2
         )
         or exists (
           select 1 from agent_context_snapshots
           where project_id = $1 and data_version_ref = $2
         )
         limit 1`,
        [projectId, subjectId],
      );
      break;
  }

  if (rows.length === 0) {
    throw new Error("File link subject does not resolve to the same project");
  }
}

async function authorizeActor(
  sql: DatabaseSql,
  actor: ActorRef,
  projectId: string,
): Promise<void> {
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "file_write");
  }
}

export async function createFileLink(
  sql: DatabaseSql,
  input: {
    fileVersionId: string;
    subjectType: FileLinkSubjectType;
    subjectId: string;
    relation: FileLinkRelation;
  },
  actor: ActorRef,
): Promise<FileLink> {
  assertSubjectType(input.subjectType);
  assertRelation(input.relation);
  if (!input.subjectId.trim()) throw new Error("File link subject id is required");

  const projectId = await loadFileProject(sql, input.fileVersionId);
  await authorizeActor(sql, actor, projectId);
  await assertSubjectInProject(sql, projectId, input.subjectType, input.subjectId);

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const rows = (await tx.unsafe(
      `insert into file_links
        (id, file_version_id, subject_type, subject_id, relation, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, file_version_id, subject_type, subject_id, relation,
                 created_by_type, created_by_id, created_at`,
      [
        id,
        input.fileVersionId,
        input.subjectType,
        input.subjectId,
        input.relation,
        actor.type,
        actor.id,
      ],
    )) as readonly FileLinkRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "FILE_LINK_CREATED",
      actor,
      payload: {
        fileLinkId: id,
        fileVersionId: input.fileVersionId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        relation: input.relation,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "file.link.created",
      payload: {
        projectId,
        fileLinkId: id,
        fileVersionId: input.fileVersionId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    });

    const row = rows[0];
    if (!row) throw new Error("File link insert returned no row");
    return toFileLink(row);
  });
}

export async function retireFileLink(
  sql: DatabaseSql,
  fileLinkId: string,
  reason: string,
  actor: ActorRef,
): Promise<{ id: string; fileLinkId: string; reason: string; createdAt: Date }> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("File link retirement reason is required");

  const linkRows = await sql.unsafe(
    `select rf.project_id
     from file_links fl
     join file_versions fv on fv.id = fl.file_version_id
     join research_files rf on rf.id = fv.research_file_id
     where fl.id = $1
     limit 1`,
    [fileLinkId],
  );
  const link = linkRows[0];
  if (!link) throw new Error("File link not found");
  const projectId = String(link.project_id);
  await authorizeActor(sql, actor, projectId);

  return runInTransaction(sql, async (tx) => {
    const id = randomUUID();
    const inserted = (await tx.unsafe(
      `insert into file_link_retirements
        (id, file_link_id, reason, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5)
       on conflict (file_link_id) do nothing
       returning id, file_link_id, reason, created_at`,
      [id, fileLinkId, normalizedReason, actor.type, actor.id],
    )) as readonly RetirementRow[];

    if (inserted[0]) {
      await appendResearchEvent(tx, {
        id: randomUUID(),
        projectId,
        eventType: "FILE_LINK_RETIRED",
        actor,
        payload: { fileLinkId, retirementId: inserted[0].id },
      });
      await enqueueOutbox(tx, {
        id: randomUUID(),
        eventType: "file.link.retired",
        payload: { projectId, fileLinkId, retirementId: inserted[0].id },
      });
      return {
        id: inserted[0].id,
        fileLinkId: inserted[0].file_link_id,
        reason: inserted[0].reason,
        createdAt: inserted[0].created_at,
      };
    }

    const existing = (await tx.unsafe(
      "select id, file_link_id, reason, created_at from file_link_retirements where file_link_id = $1 limit 1",
      [fileLinkId],
    )) as readonly RetirementRow[];
    const row = existing[0];
    if (!row) throw new Error("File link retirement idempotency lookup failed");
    return {
      id: row.id,
      fileLinkId: row.file_link_id,
      reason: row.reason,
      createdAt: row.created_at,
    };
  });
}
