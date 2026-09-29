create table if not exists teams (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists members (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  email text not null,
  display_name text not null,
  organization_role text not null,
  actor_type text not null default 'human',
  auth_user_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint members_actor_type_check check (actor_type in ('human', 'agent', 'system')),
  constraint members_organization_role_check check (organization_role in ('lead', 'researcher')),
  constraint members_team_email_unique unique (team_id, email),
  constraint members_auth_user_unique unique (auth_user_id)
);
-- statement-breakpoint
create table if not exists research_portfolios (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists research_projects (
  id text primary key,
  portfolio_id text not null references research_portfolios(id) on delete cascade,
  title text not null,
  lead_member_id text not null references members(id),
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists project_memberships (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint project_memberships_project_member_unique unique (project_id, member_id)
);
-- statement-breakpoint
create table if not exists research_dimension_states (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  dimension text not null,
  state text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  constraint research_dimension_states_project_dimension_unique unique (project_id, dimension)
);
-- statement-breakpoint
create table if not exists research_events (
  id text primary key,
  project_id text references research_projects(id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists outbox_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists integration_inbox (
  id text primary key,
  provider text not null,
  external_id text not null,
  payload jsonb not null,
  status text not null default 'accepted',
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  constraint integration_inbox_provider_external_unique unique (provider, external_id)
);
-- statement-breakpoint
create table if not exists research_tasks (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  assignee_member_id text references members(id),
  created_by text not null references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_tasks_status_check
    check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled'))
);
-- statement-breakpoint
create unique index if not exists members_one_active_lead_per_team
  on members (team_id)
  where organization_role = 'lead' and actor_type = 'human' and active = true;
-- statement-breakpoint
create or replace function reject_research_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research_events are append-only';
end;
$$;
-- statement-breakpoint
drop trigger if exists research_events_append_only on research_events;
-- statement-breakpoint
create trigger research_events_append_only
before update or delete on research_events
for each row execute function reject_research_event_mutation();

-- statement-breakpoint
create table if not exists research_nodes (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  type text not null,
  title text not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists research_node_revisions (
  id text primary key,
  node_id text not null references research_nodes(id) on delete cascade,
  revision_number integer not null,
  content jsonb not null,
  status text not null,
  created_by_type text not null,
  created_by_id text not null,
  created_at timestamptz not null default now(),
  constraint research_node_revisions_node_number_unique unique (node_id, revision_number),
  constraint research_node_revisions_status_check check (status in ('候选', '正式', '已否定')),
  constraint research_node_revisions_actor_type_check check (created_by_type in ('human', 'agent', 'system'))
);
-- statement-breakpoint
create table if not exists research_edges (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  from_node_id text not null references research_nodes(id) on delete cascade,
  to_node_id text not null references research_nodes(id) on delete cascade,
  relation text not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists research_branches (
  id text primary key,
  project_id text not null references research_projects(id) on delete cascade,
  name text not null,
  origin_node_id text not null references research_nodes(id) on delete restrict,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_branches_status_check check (status in ('open', 'closed'))
);
-- statement-breakpoint
create table if not exists research_branch_history (
  id text primary key,
  branch_id text not null references research_branches(id) on delete cascade,
  action text not null,
  reason text,
  actor_type text not null,
  actor_id text not null,
  created_at timestamptz not null default now(),
  constraint research_branch_history_action_check check (action in ('created', 'closed', 'reopened')),
  constraint research_branch_history_actor_type_check check (actor_type in ('human', 'agent', 'system'))
);
-- statement-breakpoint
create or replace function reject_research_node_revision_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'research_node_revisions are immutable and append-only';
end;
$$;
-- statement-breakpoint
drop trigger if exists research_node_revisions_immutable on research_node_revisions;
-- statement-breakpoint
create trigger research_node_revisions_immutable
before update or delete on research_node_revisions
for each row execute function reject_research_node_revision_mutation();
