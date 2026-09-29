import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchProjects } from "./project";

export const researchTasks = pgTable("research_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  assigneeMemberId: text("assignee_member_id").references(() => members.id),
  createdBy: text("created_by").notNull().references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
