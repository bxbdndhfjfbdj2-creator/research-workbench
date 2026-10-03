import { integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { agentRuns } from "./agent-runtime";
import { members } from "./member";
import { researchProjects } from "./project";
import { researchResults } from "./research-result";
import { researchTasks } from "./research-task";

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    githubInstallationId: text("github_installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    status: text("status").notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("github_installations_external_unique").on(table.githubInstallationId),
  ],
);

export const projectGithubRepositoryBindings = pgTable(
  "project_github_repository_bindings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "restrict" }),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "restrict" }),
    repositoryId: text("repository_id").notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    activePolicyRevisionId: text("active_policy_revision_id"),
    status: text("status").notNull().default("active"),
    createdByMemberId: text("created_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    unique("project_github_bindings_project_repository_unique").on(
      table.projectId,
      table.repositoryId,
    ),
  ],
);

export const githubVerificationPolicyRevisions = pgTable(
  "github_verification_policy_revisions",
  {
    id: text("id").primaryKey(),
    repositoryBindingId: text("repository_binding_id")
      .notNull()
      .references(() => projectGithubRepositoryBindings.id, { onDelete: "restrict" }),
    verificationBranch: text("verification_branch").notNull(),
    createdByMemberId: text("created_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const githubVerificationPolicyRequiredChecks = pgTable(
  "github_verification_policy_required_checks",
  {
    id: text("id").primaryKey(),
    policyRevisionId: text("policy_revision_id")
      .notNull()
      .references(() => githubVerificationPolicyRevisions.id, { onDelete: "restrict" }),
    context: text("context").notNull(),
    integrationId: text("integration_id"),
    workflowId: text("workflow_id"),
    acceptedEvents: jsonb("accepted_events").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const engineeringVerificationTargets = pgTable(
  "engineering_verification_targets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "restrict" }),
    claimedRepositoryFullName: text("claimed_repository_full_name").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("engineering_verification_targets_locator_unique").on(
      table.projectId,
      table.claimedRepositoryFullName,
      table.commitSha,
    ),
  ],
);

export const githubReferences = pgTable(
  "github_references",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "restrict" }),
    repositoryBindingId: text("repository_binding_id")
      .notNull()
      .references(() => projectGithubRepositoryBindings.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("github_references_identity_unique").on(
      table.repositoryBindingId,
      table.type,
      table.externalId,
    ),
  ],
);

export const researchResultEngineeringTargets = pgTable(
  "research_result_engineering_targets",
  {
    id: text("id").primaryKey(),
    researchResultId: text("research_result_id")
      .notNull()
      .references(() => researchResults.id, { onDelete: "restrict" }),
    targetId: text("target_id")
      .notNull()
      .references(() => engineeringVerificationTargets.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("research_result_engineering_targets_unique").on(
      table.researchResultId,
      table.targetId,
    ),
  ],
);

export const agentRunEngineeringTargets = pgTable(
  "agent_run_engineering_targets",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    targetId: text("target_id")
      .notNull()
      .references(() => engineeringVerificationTargets.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_run_engineering_targets_unique").on(table.agentRunId, table.targetId),
  ],
);

export const researchTaskEngineeringTargets = pgTable(
  "research_task_engineering_targets",
  {
    id: text("id").primaryKey(),
    researchTaskId: text("research_task_id")
      .notNull()
      .references(() => researchTasks.id, { onDelete: "restrict" }),
    targetId: text("target_id")
      .notNull()
      .references(() => engineeringVerificationTargets.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("research_task_engineering_targets_unique").on(
      table.researchTaskId,
      table.targetId,
    ),
  ],
);

export const researchResultGithubReferences = pgTable(
  "research_result_github_references",
  {
    id: text("id").primaryKey(),
    researchResultId: text("research_result_id")
      .notNull()
      .references(() => researchResults.id, { onDelete: "restrict" }),
    githubReferenceId: text("github_reference_id")
      .notNull()
      .references(() => githubReferences.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("research_result_github_references_unique").on(
      table.researchResultId,
      table.githubReferenceId,
    ),
  ],
);

export const agentRunGithubReferences = pgTable(
  "agent_run_github_references",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    githubReferenceId: text("github_reference_id")
      .notNull()
      .references(() => githubReferences.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_run_github_references_unique").on(
      table.agentRunId,
      table.githubReferenceId,
    ),
  ],
);

export const researchTaskGithubReferences = pgTable(
  "research_task_github_references",
  {
    id: text("id").primaryKey(),
    researchTaskId: text("research_task_id")
      .notNull()
      .references(() => researchTasks.id, { onDelete: "restrict" }),
    githubReferenceId: text("github_reference_id")
      .notNull()
      .references(() => githubReferences.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("research_task_github_references_unique").on(
      table.researchTaskId,
      table.githubReferenceId,
    ),
  ],
);

export const engineeringVerifications = pgTable(
  "engineering_verifications",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => engineeringVerificationTargets.id, { onDelete: "restrict" }),
    state: text("state").notNull().default("unverified"),
    reasonCode: text("reason_code"),
    repositoryBindingId: text("repository_binding_id").references(
      () => projectGithubRepositoryBindings.id,
      { onDelete: "restrict" },
    ),
    commitReferenceId: text("commit_reference_id").references(() => githubReferences.id, {
      onDelete: "restrict",
    }),
    pullRequestReferenceId: text("pull_request_reference_id").references(
      () => githubReferences.id,
      { onDelete: "restrict" },
    ),
    policyRevisionId: text("policy_revision_id").references(
      () => githubVerificationPolicyRevisions.id,
      { onDelete: "restrict" },
    ),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    lastSuccessfulReconcileAt: timestamp("last_successful_reconcile_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reconcileRequestedAt: timestamp("reconcile_requested_at", { withTimezone: true }),
    reconcileClaimedAt: timestamp("reconcile_claimed_at", { withTimezone: true }),
    nextReconcileAt: timestamp("next_reconcile_at", { withTimezone: true }),
    reconcileAttempts: integer("reconcile_attempts").notNull().default(0),
    lastReconcileErrorCode: text("last_reconcile_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("engineering_verifications_target_unique").on(table.targetId)],
);
