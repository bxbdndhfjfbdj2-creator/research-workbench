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
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint members_actor_type_check check (actor_type in ('human', 'agent', 'system')),
  constraint members_organization_role_check check (organization_role in ('lead', 'researcher')),
  constraint members_team_email_unique unique (team_id, email)
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
