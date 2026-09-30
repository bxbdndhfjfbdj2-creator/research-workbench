import { bigint, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchFiles } from "./research-file";
import { researchProjects } from "./project";

export const fileUploadIntents = pgTable(
  "file_upload_intents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "restrict" }),
    researchFileId: text("research_file_id").references(() => researchFiles.id, { onDelete: "restrict" }),
    proposedTitle: text("proposed_title"),
    fileKind: text("file_kind").notNull(),
    accessClass: text("access_class").notNull(),
    originalFilename: text("original_filename").notNull(),
    expectedByteSize: bigint("expected_byte_size", { mode: "number" }).notNull(),
    declaredMediaType: text("declared_media_type"),
    changeSummary: text("change_summary"),
    state: text("state").notNull().default("initiated"),
    tusUploadId: text("tus_upload_id"),
    quarantineBucket: text("quarantine_bucket"),
    quarantineKey: text("quarantine_key"),
    createdBy: text("created_by").notNull().references(() => members.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("file_upload_intents_tus_upload_unique").on(table.tusUploadId)],
);

export const fileIngestProcessorAttempts = pgTable("file_ingest_processor_attempts", {
  id: text("id").primaryKey(),
  uploadIntentId: text("upload_intent_id").notNull().references(() => fileUploadIntents.id, { onDelete: "restrict" }),
  processorKind: text("processor_kind").notNull(),
  processorName: text("processor_name").notNull(),
  processorVersion: text("processor_version").notNull(),
  inputHash: text("input_hash"),
  status: text("status").notNull().default("pending"),
  outputRefs: jsonb("output_refs").notNull().default([]),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
