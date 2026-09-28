import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const integrationInbox = pgTable("integration_inbox", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("accepted"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("integration_inbox_provider_external_unique").on(table.provider, table.externalId),
]);
