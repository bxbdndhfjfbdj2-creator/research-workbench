import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";

export const researchEvents = pgTable("research_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => researchProjects.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
