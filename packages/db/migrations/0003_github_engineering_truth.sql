create table if not exists github_installations (
  id text primary key,
  github_installation_id text not null,
  account_id text not null,
  account_login text not null,
  status text not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_installations_external_unique unique (github_installation_id),
  constraint github_installations_status_check
    check (status in ('active','suspended','removed'))
);
-- statement-breakpoint
create table if not exists project_github_repository_bindings (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  installation_id text not null references github_installations(id) on delete restrict,
  repository_id text not null,
  repository_full_name text not null,
  active_policy_revision_id text,
  status text not null default 'active',
  created_by_member_id text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint project_github_bindings_status_check check (status in ('active','retired')),
  constraint project_github_bindings_repo_name_check check (length(trim(repository_full_name)) > 0),
  constraint project_github_bindings_repo_id_check check (length(trim(repository_id)) > 0),
  constraint project_github_bindings_retired_at_check check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  ),
  constraint project_github_bindings_project_repository_unique unique (project_id, repository_id)
);
-- statement-breakpoint
create table if not exists github_verification_policy_revisions (
  id text primary key,
  repository_binding_id text not null references project_github_repository_bindings(id) on delete restrict,
  verification_branch text not null,
  created_by_member_id text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint github_policy_revision_branch_check check (length(trim(verification_branch)) > 0)
);
-- statement-breakpoint
alter table project_github_repository_bindings
  add constraint project_github_bindings_active_policy_fk
  foreign key (active_policy_revision_id)
  references github_verification_policy_revisions(id) on delete restrict;
-- statement-breakpoint
create table if not exists github_verification_policy_required_checks (
  id text primary key,
  policy_revision_id text not null references github_verification_policy_revisions(id) on delete restrict,
  context text not null,
  integration_id text,
  workflow_id text,
  accepted_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint github_policy_check_context_check check (length(trim(context)) > 0),
  constraint github_policy_check_events_array_check check (jsonb_typeof(accepted_events) = 'array'),
  constraint github_policy_check_events_values_check
    check (accepted_events <@ '["pull_request","push","merge_group"]'::jsonb)
);
-- statement-breakpoint
create table if not exists engineering_verification_targets (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  claimed_repository_full_name text not null,
  commit_sha text not null,
  created_at timestamptz not null default now(),
  constraint engineering_targets_repo_check check (length(trim(claimed_repository_full_name)) > 0),
  constraint engineering_targets_sha_check check (commit_sha ~ '^[0-9a-f]{40}$'),
  constraint engineering_targets_locator_unique
    unique (project_id, claimed_repository_full_name, commit_sha)
);
-- statement-breakpoint
create table if not exists github_references (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  repository_binding_id text not null references project_github_repository_bindings(id) on delete restrict,
  type text not null,
  external_id text not null,
  url text not null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  constraint github_references_type_check
    check (type in ('issue','branch','commit','pull_request','review','workflow_run')),
  constraint github_references_external_id_check check (length(trim(external_id)) > 0),
  constraint github_references_url_check check (length(trim(url)) > 0),
  constraint github_references_observed_order_check check (last_observed_at >= first_observed_at),
  constraint github_references_identity_unique unique (repository_binding_id, type, external_id)
);
-- statement-breakpoint
create table if not exists research_result_engineering_targets (
  id text primary key,
  research_result_id text not null references research_results(id) on delete restrict,
  target_id text not null references engineering_verification_targets(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint rr_engineering_targets_unique unique (research_result_id, target_id)
);
-- statement-breakpoint
create table if not exists agent_run_engineering_targets (
  id text primary key,
  agent_run_id text not null references agent_runs(id) on delete restrict,
  target_id text not null references engineering_verification_targets(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ar_engineering_targets_unique unique (agent_run_id, target_id)
);
-- statement-breakpoint
create table if not exists research_task_engineering_targets (
  id text primary key,
  research_task_id text not null references research_tasks(id) on delete restrict,
  target_id text not null references engineering_verification_targets(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint rt_engineering_targets_unique unique (research_task_id, target_id)
);
-- statement-breakpoint
create table if not exists research_result_github_references (
  id text primary key,
  research_result_id text not null references research_results(id) on delete restrict,
  github_reference_id text not null references github_references(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint rr_github_references_unique unique (research_result_id, github_reference_id)
);
-- statement-breakpoint
create table if not exists agent_run_github_references (
  id text primary key,
  agent_run_id text not null references agent_runs(id) on delete restrict,
  github_reference_id text not null references github_references(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ar_github_references_unique unique (agent_run_id, github_reference_id)
);
-- statement-breakpoint
create table if not exists research_task_github_references (
  id text primary key,
  research_task_id text not null references research_tasks(id) on delete restrict,
  github_reference_id text not null references github_references(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint rt_github_references_unique unique (research_task_id, github_reference_id)
);
-- statement-breakpoint
create table if not exists engineering_verifications (
  id text primary key,
  target_id text not null references engineering_verification_targets(id) on delete restrict,
  state text not null default 'unverified',
  reason_code text,
  repository_binding_id text references project_github_repository_bindings(id) on delete restrict,
  commit_reference_id text references github_references(id) on delete restrict,
  pull_request_reference_id text references github_references(id) on delete restrict,
  policy_revision_id text references github_verification_policy_revisions(id) on delete restrict,
  last_reconciled_at timestamptz,
  last_successful_reconcile_at timestamptz,
  verified_at timestamptz,
  reconcile_requested_at timestamptz,
  reconcile_claimed_at timestamptz,
  next_reconcile_at timestamptz,
  reconcile_attempts integer not null default 0,
  last_reconcile_error_code text,
  updated_at timestamptz not null default now(),
  constraint engineering_verifications_target_unique unique (target_id),
  constraint engineering_verifications_attempts_check check (reconcile_attempts >= 0),
  constraint engineering_verifications_state_check
    check (state in ('unverified','awaiting_pr','pending_ci','verified','failed','unknown')),
  constraint engineering_verifications_reason_check
    check (reason_code is null or reason_code in (
      'repository_not_bound',
      'commit_not_found',
      'no_qualifying_pull_request',
      'pull_request_not_merged',
      'required_checks_not_configured',
      'required_check_missing',
      'required_checks_pending',
      'required_check_failed',
      'required_check_cancelled',
      'required_check_timed_out',
      'required_check_skipped',
      'required_check_neutral',
      'required_check_action_required',
      'required_check_stale',
      'required_check_conflict',
      'github_unavailable',
      'github_rate_limited',
      'github_auth_unavailable',
      'unsupported_merge_queue'
    ))
);
-- statement-breakpoint
create or replace function reject_github_policy_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'GitHub verification policy records are immutable and append-only';
end;
$$;
-- statement-breakpoint
drop trigger if exists github_policy_revisions_immutable on github_verification_policy_revisions;
-- statement-breakpoint
create trigger github_policy_revisions_immutable
before update or delete on github_verification_policy_revisions
for each row execute function reject_github_policy_mutation();
-- statement-breakpoint
drop trigger if exists github_policy_required_checks_immutable on github_verification_policy_required_checks;
-- statement-breakpoint
create trigger github_policy_required_checks_immutable
before update or delete on github_verification_policy_required_checks
for each row execute function reject_github_policy_mutation();
-- statement-breakpoint
create index if not exists engineering_verifications_reconcile_idx
  on engineering_verifications (next_reconcile_at, reconcile_requested_at)
  where state <> 'verified';
