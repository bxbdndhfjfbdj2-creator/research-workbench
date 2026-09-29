import { integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { researchProjects } from "./project";
import { researchTasks } from "./research-task";

export const agentTasks = pgTable("agent_tasks", {
  id: text("id").primaryKey(),
  researchTaskId: text("research_task_id").notNull().references(() => researchTasks.id, { onDelete: "restrict" }),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  request: jsonb("request").notNull(),
  createdByType: text("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentContextSnapshots = pgTable("agent_context_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  researchQuestionRevisionId: text("research_question_revision_id"),
  theoryRevisionId: text("theory_revision_id"),
  researchDesignRevisionId: text("research_design_revision_id"),
  dataVersionRef: text("data_version_ref"),
  assetVersionRefs: jsonb("asset_version_refs").notNull(),
  gitBaseCommit: text("git_base_commit"),
  skillVersionRefs: jsonb("skill_version_refs").notNull(),
  harnessVersion: text("harness_version").notNull(),
  harnessProfile: text("harness_profile").notNull(),
  runtimeProfile: text("runtime_profile").notNull(),
  modelRoute: text("model_route").notNull(),
  sandboxPolicy: text("sandbox_policy").notNull(),
  toolAllowlist: jsonb("tool_allowlist").notNull(),
  subagentAllowlist: jsonb("subagent_allowlist").notNull(),
  executionMetadata: jsonb("execution_metadata"),
  createdByType: text("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    agentTaskId: text("agent_task_id").notNull().references(() => agentTasks.id, { onDelete: "restrict" }),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    contextSnapshotId: text("context_snapshot_id").references(() => agentContextSnapshots.id, { onDelete: "restrict" }),
    state: text("state").notNull().default("已提议"),
    executionPolicy: jsonb("execution_policy").notNull(),
    failureCode: text("failure_code"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_runs_task_attempt_unique").on(table.agentTaskId, table.attemptNumber),
  ],
);

export const agentCallbackCredentials = pgTable("agent_callback_credentials", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentHumanInteractions = pgTable(
  "agent_human_interactions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    nonce: text("nonce").notNull(),
    credentialRef: text("credential_ref").notNull().references(() => agentCallbackCredentials.id, { onDelete: "restrict" }),
    state: text("state").notNull().default("pending"),
    answer: jsonb("answer"),
    answeredByMemberId: text("answered_by_member_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (table) => [
    unique("agent_human_interactions_run_nonce_unique").on(table.runId, table.nonce),
  ],
);

export const agentRunArtifacts = pgTable("agent_run_artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentRunIngestions = pgTable("agent_run_ingestions", {
  runId: text("run_id").primaryKey().references(() => agentRuns.id, { onDelete: "restrict" }),
  researchResultId: text("research_result_id"),
  decisionIds: jsonb("decision_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
