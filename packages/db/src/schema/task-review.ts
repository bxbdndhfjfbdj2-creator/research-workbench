import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { members } from "./member";
import { researchProjects } from "./project";
import { researchTasks } from "./research-task";
import { scientificDecisions } from "./scientific-decision";

export const taskSubmissions = pgTable(
  "task_submissions",
  {
    id: text("id").primaryKey(),
    researchTaskId: text("research_task_id").notNull().references(() => researchTasks.id, { onDelete: "restrict" }),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "restrict" }),
    submissionNumber: integer("submission_number").notNull(),
    summary: text("summary").notNull(),
    requirementSnapshot: jsonb("requirement_snapshot").notNull(),
    requirementSnapshotSchemaVersion: integer("requirement_snapshot_schema_version").notNull(),
    submittedByMemberId: text("submitted_by_member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("task_submissions_task_number_unique").on(
      table.researchTaskId,
      table.submissionNumber,
    ),
  ],
);

export const taskSubmissionContributors = pgTable(
  "task_submission_contributors",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => taskSubmissions.id, { onDelete: "restrict" }),
    contributorKind: text("contributor_kind").notNull(),
    contributorRef: text("contributor_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("task_submission_contributors_unique").on(
      table.submissionId,
      table.contributorKind,
      table.contributorRef,
    ),
  ],
);

export const taskSubmissionRefs = pgTable(
  "task_submission_refs",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => taskSubmissions.id, { onDelete: "restrict" }),
    refKind: text("ref_kind").notNull(),
    refId: text("ref_id").notNull(),
    relation: text("relation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("task_submission_refs_unique").on(
      table.submissionId,
      table.refKind,
      table.refId,
      table.relation,
    ),
  ],
);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => researchProjects.id, { onDelete: "restrict" }),
    taskSubmissionId: text("task_submission_id").notNull().references(() => taskSubmissions.id, { onDelete: "restrict" }),
    reviewerMemberId: text("reviewer_member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    createdByMemberId: text("created_by_member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("review_requests_submission_unique").on(table.taskSubmissionId),
  ],
);

export const reviewActions = pgTable("review_actions", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  previousReviewerMemberId: text("previous_reviewer_member_id").references(() => members.id, { onDelete: "restrict" }),
  newReviewerMemberId: text("new_reviewer_member_id").references(() => members.id, { onDelete: "restrict" }),
  comment: text("comment"),
  resultingStatus: text("resulting_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reviewDecisionLinks = pgTable(
  "review_decision_links",
  {
    id: text("id").primaryKey(),
    reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id, { onDelete: "restrict" }),
    scientificDecisionId: text("scientific_decision_id").notNull().references(() => scientificDecisions.id, { onDelete: "restrict" }),
    createdByMemberId: text("created_by_member_id").notNull().references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("review_decision_links_decision_unique").on(table.scientificDecisionId),
  ],
);
