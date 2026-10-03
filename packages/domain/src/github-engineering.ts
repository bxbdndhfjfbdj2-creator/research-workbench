export const ENGINEERING_VERIFICATION_STATES = [
  "unverified",
  "awaiting_pr",
  "pending_ci",
  "verified",
  "failed",
  "unknown",
] as const;

export type EngineeringVerificationState =
  (typeof ENGINEERING_VERIFICATION_STATES)[number];

export const ENGINEERING_VERIFICATION_REASON_CODES = [
  "repository_not_bound",
  "commit_not_found",
  "no_qualifying_pull_request",
  "pull_request_not_merged",
  "required_checks_not_configured",
  "required_check_missing",
  "required_checks_pending",
  "required_check_failed",
  "required_check_cancelled",
  "required_check_timed_out",
  "required_check_skipped",
  "required_check_neutral",
  "required_check_action_required",
  "required_check_stale",
  "required_check_conflict",
  "github_unavailable",
  "github_rate_limited",
  "github_auth_unavailable",
  "unsupported_merge_queue",
] as const;

export type EngineeringVerificationReasonCode =
  (typeof ENGINEERING_VERIFICATION_REASON_CODES)[number];

export const GITHUB_REFERENCE_TYPES = [
  "issue",
  "branch",
  "commit",
  "pull_request",
  "review",
  "workflow_run",
] as const;

export type GitHubReferenceType = (typeof GITHUB_REFERENCE_TYPES)[number];

export const GITHUB_INSTALLATION_STATUSES = [
  "active",
  "suspended",
  "removed",
] as const;

export type GitHubInstallationStatus =
  (typeof GITHUB_INSTALLATION_STATUSES)[number];

export const GITHUB_REPOSITORY_BINDING_STATUSES = ["active", "retired"] as const;

export type GitHubRepositoryBindingStatus =
  (typeof GITHUB_REPOSITORY_BINDING_STATUSES)[number];

export const GITHUB_VERIFICATION_ACCEPTED_EVENTS = [
  "pull_request",
  "push",
  "merge_group",
] as const;

export type GitHubVerificationAcceptedEvent =
  (typeof GITHUB_VERIFICATION_ACCEPTED_EVENTS)[number];
