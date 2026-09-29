import { jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";
import { researchNodeRevisions } from "./research-graph";

export const researchResults = pgTable("research_results", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  dataVersionRef: text("data_version_ref").notNull(),
  analysisRevisionId: text("analysis_revision_id").notNull().references(() => researchNodeRevisions.id, { onDelete: "restrict" }),
  executionKind: text("execution_kind").notNull(),
  runRef: text("run_ref").notNull(),
  outputRefs: jsonb("output_refs").notNull(),
  gitRepositoryFullName: text("git_repository_full_name"),
  gitCommitSha: text("git_commit_sha"),
  createdByType: text("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const researchResultSupersessions = pgTable(
  "research_result_supersessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    newResultId: text("new_result_id").notNull().references(() => researchResults.id, { onDelete: "restrict" }),
    oldResultId: text("old_result_id").notNull().references(() => researchResults.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("research_result_supersessions_old_unique").on(table.oldResultId)],
);

export const researchResultEvidenceLinks = pgTable("research_result_evidence_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  resultId: text("result_id").notNull().references(() => researchResults.id, { onDelete: "restrict" }),
  revisionId: text("revision_id").notNull().references(() => researchNodeRevisions.id, { onDelete: "restrict" }),
  relation: text("relation").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
