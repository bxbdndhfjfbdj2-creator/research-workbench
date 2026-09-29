import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { agentRuns } from "./agent-runtime";

export const harnessSessionReferences = pgTable(
  "harness_session_references",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
    sessionId: text("session_id").notNull(),
    runtimeProfile: text("runtime_profile").notNull(),
    harnessVersion: text("harness_version").notNull(),
    generation: integer("generation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("harness_session_references_run_generation_unique").on(table.runId, table.generation),
  ],
);
