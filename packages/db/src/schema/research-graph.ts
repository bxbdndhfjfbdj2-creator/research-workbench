import { integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";

export const researchNodes = pgTable("research_nodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const researchNodeRevisions = pgTable(
  "research_node_revisions",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id").notNull().references(() => researchNodes.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    content: jsonb("content").notNull(),
    status: text("status").notNull(),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("research_node_revisions_node_number_unique").on(table.nodeId, table.revisionNumber)],
);

export const researchEdges = pgTable("research_edges", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  fromNodeId: text("from_node_id").notNull().references(() => researchNodes.id, { onDelete: "cascade" }),
  toNodeId: text("to_node_id").notNull().references(() => researchNodes.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const researchBranches = pgTable("research_branches", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  originNodeId: text("origin_node_id").notNull().references(() => researchNodes.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const researchBranchHistory = pgTable("research_branch_history", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => researchBranches.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  reason: text("reason"),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
