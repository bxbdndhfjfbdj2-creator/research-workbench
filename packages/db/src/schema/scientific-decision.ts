import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";

export const scientificDecisions = pgTable("scientific_decisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  level: text("level").notNull(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").notNull(),
  impact: jsonb("impact").notNull(),
  changeKind: text("change_kind").notNull(),
  targetSlot: text("target_slot"),
  targetRevisionId: text("target_revision_id"),
  status: text("status").notNull().default("proposed"),
  proposedByType: text("proposed_by_type").notNull(),
  proposedById: text("proposed_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const decisionReviews = pgTable("decision_reviews", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull().references(() => scientificDecisions.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  action: text("action").notNull(),
  reviewerMemberId: text("reviewer_member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
