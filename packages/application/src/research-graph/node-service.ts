import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ActorRef } from "@research-workbench/domain/src/actor";
import {
  NODE_REVISION_STATUSES,
  RESEARCH_EDGE_RELATIONS,
  RESEARCH_NODE_TYPES,
  type NodeRevisionStatus,
  type ResearchEdge,
  type ResearchEdgeRelation,
  type ResearchNode,
  type ResearchNodeRevision,
  type ResearchNodeType,
} from "@research-workbench/domain/src/research-graph";
import type { JsonValue } from "@research-workbench/domain/src/events";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";

function assertEnum<T extends string>(value: string, allowed: readonly T[], label: string): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

async function projectIdForNode(sql: Pick<DatabaseSql, "unsafe">, nodeId: string): Promise<string> {
  const rows = await sql.unsafe("select project_id from research_nodes where id = $1 limit 1", [nodeId]);
  const row = rows[0];
  if (!row) throw new Error("Research node not found");
  return String(row.project_id);
}

async function authorizeGraphMutation(sql: DatabaseSql, projectId: string, actor: ActorRef): Promise<void> {
  if (actor.type === "human") {
    await authorizeProjectAccess(sql, actor.id, projectId, "write");
    return;
  }
  const rows = await sql.unsafe("select 1 from research_projects where id = $1 limit 1", [projectId]);
  if (rows.length === 0) throw new Error("Research project not found");
}

export async function createResearchNode(
  sql: DatabaseSql,
  projectId: string,
  type: ResearchNodeType,
  title: string,
  actor: ActorRef,
): Promise<ResearchNode> {
  assertEnum(type, RESEARCH_NODE_TYPES, "research node type");
  await authorizeGraphMutation(sql, projectId, actor);
  const id = randomUUID();

  return runInTransaction(sql, async (tx) => {
    const rows = await tx.unsafe(
      `insert into research_nodes (id, project_id, type, title)
       values ($1, $2, $3, $4)
       returning id, project_id, type, title, created_at`,
      [id, projectId, type, title.trim()],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "RESEARCH_NODE_CREATED",
      actor,
      payload: { nodeId: id, type, title: title.trim() },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.node.created",
      payload: { projectId, nodeId: id },
    });
    const row = rows[0];
    if (!row) throw new Error("Research node insert returned no row");
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      type: row.type as ResearchNodeType,
      title: String(row.title),
      createdAt: row.created_at as Date,
    };
  });
}

export async function createNodeRevision(
  sql: DatabaseSql,
  nodeId: string,
  content: JsonValue,
  status: NodeRevisionStatus,
  actor: ActorRef,
): Promise<ResearchNodeRevision> {
  assertEnum(status, NODE_REVISION_STATUSES, "node revision status");
  const projectId = await projectIdForNode(sql, nodeId);
  await authorizeGraphMutation(sql, projectId, actor);
  if (actor.type !== "human" && status !== "候选") {
    throw new Error("AI and system actors may only create candidate revisions");
  }

  return runInTransaction(sql, async (tx) => {
    await tx.unsafe("select pg_advisory_xact_lock(hashtext($1))", [nodeId]);
    const numberRows = await tx.unsafe(
      "select coalesce(max(revision_number), 0)::int + 1 as next_number from research_node_revisions where node_id = $1",
      [nodeId],
    );
    const revisionNumber = Number(numberRows[0]?.next_number ?? 1);
    const id = randomUUID();
    const rows = await tx.unsafe(
      `insert into research_node_revisions
        (id, node_id, revision_number, content, status, created_by_type, created_by_id)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       returning id, node_id, revision_number, content, status, created_by_type, created_by_id, created_at`,
      [id, nodeId, revisionNumber, JSON.stringify(content), status, actor.type, actor.id],
    );

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: actor.type === "human" ? "NODE_REVISION_CREATED" : "NODE_REVISION_PROPOSED",
      actor,
      payload: { nodeId, revisionId: id, revisionNumber, status },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.node.revision.created",
      payload: { projectId, nodeId, revisionId: id },
    });

    const row = rows[0];
    if (!row) throw new Error("Research node revision insert returned no row");
    return {
      id: String(row.id),
      nodeId: String(row.node_id),
      revisionNumber: Number(row.revision_number),
      content: row.content as JsonValue,
      status: row.status as NodeRevisionStatus,
      createdByType: row.created_by_type as ActorRef["type"],
      createdById: String(row.created_by_id),
      createdAt: row.created_at as Date,
    };
  });
}

export async function linkResearchNodes(
  sql: DatabaseSql,
  fromNodeId: string,
  toNodeId: string,
  relation: ResearchEdgeRelation,
  actor: ActorRef,
): Promise<ResearchEdge> {
  assertEnum(relation, RESEARCH_EDGE_RELATIONS, "research edge relation");
  const fromProjectId = await projectIdForNode(sql, fromNodeId);
  const toProjectId = await projectIdForNode(sql, toNodeId);
  if (fromProjectId !== toProjectId) throw new Error("Research edges cannot cross projects");
  await authorizeGraphMutation(sql, fromProjectId, actor);
  const id = randomUUID();

  return runInTransaction(sql, async (tx) => {
    const rows = await tx.unsafe(
      `insert into research_edges (id, project_id, from_node_id, to_node_id, relation)
       values ($1, $2, $3, $4, $5)
       returning id, project_id, from_node_id, to_node_id, relation, created_at`,
      [id, fromProjectId, fromNodeId, toNodeId, relation],
    );
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId: fromProjectId,
      eventType: "RESEARCH_EDGE_CREATED",
      actor,
      payload: { edgeId: id, fromNodeId, toNodeId, relation },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "research.edge.created",
      payload: { projectId: fromProjectId, edgeId: id },
    });
    const row = rows[0];
    if (!row) throw new Error("Research edge insert returned no row");
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      relation: row.relation as ResearchEdgeRelation,
      createdAt: row.created_at as Date,
    };
  });
}
