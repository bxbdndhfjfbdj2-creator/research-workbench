import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchProjects } from "./project";

export const researchTasks = pgTable("research_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  assigneeMemberId: text("assignee_member_id").notNull().references(() => members.id),
  executionMode: text("execution_mode").notNull().default("human"),
  reviewPolicy: text("review_policy").notNull().default("none"),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
  workflowVersion: integer("workflow_version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
