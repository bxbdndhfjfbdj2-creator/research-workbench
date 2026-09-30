update research_tasks
set assignee_member_id = created_by
where assignee_member_id is null;
-- statement-breakpoint
alter table research_tasks
  alter column assignee_member_id set not null;
-- statement-breakpoint
alter table research_tasks
  add column if not exists execution_mode text not null default 'human';
-- statement-breakpoint
alter table research_tasks
  add column if not exists review_policy text not null default 'none';
-- statement-breakpoint
alter table research_tasks
  add column if not exists acceptance_criteria jsonb not null default '[]'::jsonb;
-- statement-breakpoint
alter table research_tasks
  add column if not exists workflow_version integer not null default 1;
-- statement-breakpoint
alter table research_tasks
  drop constraint if exists research_tasks_status_check;
-- statement-breakpoint
alter table research_tasks
  add constraint research_tasks_status_check
  check (status in ('open','in_progress','blocked','awaiting_review','completed','cancelled'));
-- statement-breakpoint
alter table research_tasks
  add constraint research_tasks_execution_mode_check
  check (execution_mode in ('human','agent','hybrid'));
-- statement-breakpoint
alter table research_tasks
  add constraint research_tasks_review_policy_check
  check (review_policy in ('none','required'));
-- statement-breakpoint
alter table research_tasks
  add constraint research_tasks_acceptance_criteria_array_check
  check (jsonb_typeof(acceptance_criteria) = 'array');
-- statement-breakpoint
alter table research_tasks
  add constraint research_tasks_workflow_version_check
  check (workflow_version in (1,2));
-- statement-breakpoint
create table if not exists task_submissions (
  id text primary key,
  research_task_id text not null references research_tasks(id) on delete restrict,
  project_id text not null references research_projects(id) on delete restrict,
  submission_number integer not null,
  summary text not null,
  requirement_snapshot jsonb not null,
  requirement_snapshot_schema_version integer not null,
  submitted_by_member_id text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_submissions_number_check check (submission_number >= 1),
  constraint task_submissions_summary_check check (length(trim(summary)) > 0),
  constraint task_submissions_snapshot_object_check check (jsonb_typeof(requirement_snapshot) = 'object'),
  constraint task_submissions_snapshot_version_check check (requirement_snapshot_schema_version >= 1),
  constraint task_submissions_task_number_unique unique (research_task_id, submission_number)
);
-- statement-breakpoint
create table if not exists task_submission_contributors (
  id text primary key,
  submission_id text not null references task_submissions(id) on delete restrict,
  contributor_kind text not null,
  contributor_ref text not null,
  created_at timestamptz not null default now(),
  constraint task_submission_contributors_kind_check
    check (contributor_kind in ('human_member','agent_run')),
  constraint task_submission_contributors_ref_check check (length(trim(contributor_ref)) > 0),
  constraint task_submission_contributors_unique
    unique (submission_id, contributor_kind, contributor_ref)
);
-- statement-breakpoint
create table if not exists task_submission_refs (
  id text primary key,
  submission_id text not null references task_submissions(id) on delete restrict,
  ref_kind text not null,
  ref_id text not null,
  relation text not null,
  created_at timestamptz not null default now(),
  constraint task_submission_refs_kind_check
    check (ref_kind in ('file_version','research_result','research_node_revision','agent_run')),
  constraint task_submission_refs_relation_check
    check (relation in ('deliverable','evidence','source','context')),
  constraint task_submission_refs_id_check check (length(trim(ref_id)) > 0),
  constraint task_submission_refs_unique
    unique (submission_id, ref_kind, ref_id, relation)
);
-- statement-breakpoint
create table if not exists review_requests (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  task_submission_id text not null references task_submissions(id) on delete restrict,
  reviewer_member_id text not null references members(id) on delete restrict,
  status text not null default 'pending',
  created_by_member_id text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_requests_status_check
    check (status in (
      'pending','awaiting_scientific_decision','approved',
      'changes_requested','rejected','cancelled'
    )),
  constraint review_requests_submission_unique unique (task_submission_id)
);
-- statement-breakpoint
create table if not exists review_actions (
  id text primary key,
  review_request_id text not null references review_requests(id) on delete restrict,
  action text not null,
  actor_type text not null,
  actor_id text not null,
  previous_reviewer_member_id text references members(id) on delete restrict,
  new_reviewer_member_id text references members(id) on delete restrict,
  comment text,
  resulting_status text not null,
  created_at timestamptz not null default now(),
  constraint review_actions_action_check
    check (action in (
      'assigned','reassigned','approve','request_changes','reject','cancel',
      'escalate_to_scientific_decision','scientific_decision_resolved'
    )),
  constraint review_actions_actor_type_check check (actor_type in ('human','system')),
  constraint review_actions_resulting_status_check
    check (resulting_status in (
      'pending','awaiting_scientific_decision','approved',
      'changes_requested','rejected','cancelled'
    ))
);
-- statement-breakpoint
create table if not exists review_decision_links (
  id text primary key,
  review_request_id text not null references review_requests(id) on delete restrict,
  scientific_decision_id text not null references scientific_decisions(id) on delete restrict,
  created_by_member_id text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint review_decision_links_decision_unique unique (scientific_decision_id)
);
-- statement-breakpoint
create index if not exists task_submissions_task_created_idx
  on task_submissions (research_task_id, created_at desc);
-- statement-breakpoint
create index if not exists review_requests_reviewer_status_idx
  on review_requests (reviewer_member_id, status, created_at);
-- statement-breakpoint
drop trigger if exists task_submissions_immutable on task_submissions;
-- statement-breakpoint
create trigger task_submissions_immutable
before update or delete on task_submissions
for each row execute function reject_append_only_record_mutation();
-- statement-breakpoint
drop trigger if exists task_submission_contributors_immutable on task_submission_contributors;
-- statement-breakpoint
create trigger task_submission_contributors_immutable
before update or delete on task_submission_contributors
for each row execute function reject_append_only_record_mutation();
-- statement-breakpoint
drop trigger if exists task_submission_refs_immutable on task_submission_refs;
-- statement-breakpoint
create trigger task_submission_refs_immutable
before update or delete on task_submission_refs
for each row execute function reject_append_only_record_mutation();
-- statement-breakpoint
drop trigger if exists review_actions_immutable on review_actions;
-- statement-breakpoint
create trigger review_actions_immutable
before update or delete on review_actions
for each row execute function reject_append_only_record_mutation();
-- statement-breakpoint
drop trigger if exists review_decision_links_immutable on review_decision_links;
-- statement-breakpoint
create trigger review_decision_links_immutable
before update or delete on review_decision_links
for each row execute function reject_append_only_record_mutation();
