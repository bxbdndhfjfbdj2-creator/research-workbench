import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";
import { researchNodeRevisions } from "./research-graph";

export const officialRevisions = pgTable(
  "official_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    revisionId: text("revision_id").notNull().references(() => researchNodeRevisions.id, { onDelete: "restrict" }),
    decisionId: text("decision_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("official_revisions_project_slot_unique").on(table.projectId, table.slot)],
);

export const officialRevisionHistory = pgTable("official_revision_history", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  slot: text("slot").notNull(),
  revisionId: text("revision_id").notNull().references(() => researchNodeRevisions.id, { onDelete: "restrict" }),
  decisionId: text("decision_id").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
});
