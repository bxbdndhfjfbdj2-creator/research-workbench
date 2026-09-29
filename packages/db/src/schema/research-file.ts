import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchProjects } from "./project";

export const researchFiles = pgTable("research_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  fileKind: text("file_kind").notNull(),
  description: text("description"),
  currentVersionId: text("current_version_id"),
  accessClass: text("access_class").notNull(),
  lifecycleState: text("lifecycle_state").notNull().default("draft"),
  createdBy: text("created_by").notNull().references(() => members.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileBlobs = pgTable(
  "file_blobs",
  {
    id: text("id").primaryKey(),
    sha256: text("sha256").notNull(),
    storageBackend: text("storage_backend").notNull(),
    storageKey: text("storage_key").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mediaTypeDetected: text("media_type_detected"),
    quarantineState: text("quarantine_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("file_blobs_backend_hash_unique").on(table.storageBackend, table.sha256),
    unique("file_blobs_storage_key_unique").on(table.storageBackend, table.storageKey),
  ],
);

export const externalDataReferences = pgTable("external_data_references", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "restrict" }),
  uriOrLocator: text("uri_or_locator").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  accessPolicyRef: text("access_policy_ref").notNull(),
  licenseOrAgreementRef: text("license_or_agreement_ref"),
  versionLabel: text("version_label").notNull(),
  createdBy: text("created_by").notNull().references(() => members.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileVersions = pgTable(
  "file_versions",
  {
    id: text("id").primaryKey(),
    researchFileId: text("research_file_id").notNull().references(() => researchFiles.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    blobId: text("blob_id").references(() => fileBlobs.id, { onDelete: "restrict" }),
    externalReferenceId: text("external_reference_id").references(() => externalDataReferences.id, { onDelete: "restrict" }),
    originalFilename: text("original_filename").notNull(),
    mediaType: text("media_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    sourceKind: text("source_kind").notNull(),
    sourceMetadata: jsonb("source_metadata").notNull().default({}),
    changeSummary: text("change_summary"),
    scanStatus: text("scan_status").notNull(),
    parseStatus: text("parse_status").notNull(),
    createdBy: text("created_by").notNull().references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("file_versions_research_file_number_unique").on(table.researchFileId, table.versionNumber)],
);

export const fileLinks = pgTable("file_links", {
  id: text("id").primaryKey(),
  fileVersionId: text("file_version_id").notNull().references(() => fileVersions.id, { onDelete: "restrict" }),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  relation: text("relation").notNull(),
  createdByType: text("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileLinkRetirements = pgTable(
  "file_link_retirements",
  {
    id: text("id").primaryKey(),
    fileLinkId: text("file_link_id").notNull().references(() => fileLinks.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("file_link_retirements_link_unique").on(table.fileLinkId)],
);

export const fileProcessingRecords = pgTable("file_processing_records", {
  id: text("id").primaryKey(),
  fileVersionId: text("file_version_id").notNull().references(() => fileVersions.id, { onDelete: "restrict" }),
  processorKind: text("processor_kind").notNull(),
  processorName: text("processor_name").notNull(),
  processorVersion: text("processor_version").notNull(),
  status: text("status").notNull(),
  inputHash: text("input_hash").notNull(),
  outputRefs: jsonb("output_refs").notNull().default([]),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileSearchDocuments = pgTable("file_search_documents", {
  fileVersionId: text("file_version_id").primaryKey().references(() => fileVersions.id, { onDelete: "cascade" }),
  researchFileId: text("research_file_id").notNull().references(() => researchFiles.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  extractedText: text("extracted_text"),
  metadata: jsonb("metadata").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
