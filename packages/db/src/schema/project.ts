import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchPortfolios } from "./team";

export const researchProjects = pgTable("research_projects", {
  id: text("id").primaryKey(),
  portfolioId: text("portfolio_id").notNull().references(() => researchPortfolios.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  leadMemberId: text("lead_member_id").notNull().references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectMemberships = pgTable("project_memberships", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_memberships_project_member_unique").on(table.projectId, table.memberId),
]);

export const researchDimensionStates = pgTable("research_dimension_states", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  dimension: text("dimension").notNull(),
  state: text("state").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_dimension_states_project_dimension_unique").on(table.projectId, table.dimension),
]);
