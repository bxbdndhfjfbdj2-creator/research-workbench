create table if not exists research_files (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  title text not null,
  file_kind text not null,
  description text,
  current_version_id text,
  access_class text not null,
  lifecycle_state text not null default 'draft',
  created_by text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint research_files_kind_check check (file_kind in (
    'literature','data_documentation','dataset','analysis_output','code_archive',
    'research_design','manuscript','review_material','meeting_note',
    'ethics_or_license','presentation','general_attachment'
  )),
  constraint research_files_access_class_check check (access_class in ('project','restricted'))
);
-- statement-breakpoint
create table if not exists file_blobs (
  id text primary key,
  sha256 text not null,
  storage_backend text not null,
  storage_key text not null,
  byte_size bigint not null,
  media_type_detected text,
  quarantine_state text not null,
  created_at timestamptz not null default now(),
  constraint file_blobs_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint file_blobs_byte_size_check check (byte_size >= 0),
  constraint file_blobs_backend_hash_unique unique (storage_backend, sha256),
  constraint file_blobs_storage_key_unique unique (storage_backend, storage_key)
);
-- statement-breakpoint
create table if not exists external_data_references (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  uri_or_locator text not null,
  manifest_hash text not null,
  access_policy_ref text not null,
  license_or_agreement_ref text,
  version_label text not null,
  created_by text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint external_data_references_manifest_hash_check check (length(trim(manifest_hash)) > 0)
);
-- statement-breakpoint
create table if not exists file_versions (
  id text primary key,
  research_file_id text not null references research_files(id) on delete restrict,
  version_number integer not null,
  blob_id text references file_blobs(id) on delete restrict,
  external_reference_id text references external_data_references(id) on delete restrict,
  original_filename text not null,
  media_type text,
  byte_size bigint,
  sha256 text,
  source_kind text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  change_summary text,
  scan_status text not null,
  parse_status text not null,
  created_by text not null references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint file_versions_number_check check (version_number >= 1),
  constraint file_versions_research_file_number_unique unique (research_file_id, version_number),
  constraint file_versions_source_kind_check check (source_kind in ('upload','external_reference')),
  constraint file_versions_scan_status_check check (scan_status in ('passed','not_applicable')),
  constraint file_versions_parse_status_check check (parse_status in ('parsed','failed','not_applicable')),
  constraint file_versions_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint file_versions_backing_check check (
    (
      blob_id is not null
      and external_reference_id is null
      and source_kind = 'upload'
      and media_type is not null
      and byte_size is not null
      and byte_size >= 0
      and sha256 is not null
      and scan_status = 'passed'
      and parse_status in ('parsed','failed')
    )
    or
    (
      blob_id is null
      and external_reference_id is not null
      and source_kind = 'external_reference'
      and media_type is null
      and byte_size is null
      and sha256 is null
      and scan_status = 'not_applicable'
      and parse_status = 'not_applicable'
    )
  )
);
-- statement-breakpoint
alter table research_files
  add constraint research_files_current_version_fk
  foreign key (current_version_id) references file_versions(id) on delete restrict;
-- statement-breakpoint
create table if not exists file_links (
  id text primary key,
  file_version_id text not null references file_versions(id) on delete restrict,
  subject_type text not null,
  subject_id text not null,
  relation text not null,
  created_by_type text not null,
  created_by_id text not null,
  created_at timestamptz not null default now(),
  constraint file_links_subject_type_check check (subject_type in (
    'research_node_revision','research_task','research_result',
    'scientific_decision','project','data_version'
  )),
  constraint file_links_relation_check check (relation in (
    'documents','input_to','output_of','supports','challenges','review_material','source_for'
  )),
  constraint file_links_actor_type_check check (created_by_type in ('human','agent','system'))
);
-- statement-breakpoint
create table if not exists file_link_retirements (
  id text primary key,
  file_link_id text not null references file_links(id) on delete restrict,
  reason text not null,
  created_by_type text not null,
  created_by_id text not null,
  created_at timestamptz not null default now(),
  constraint file_link_retirements_link_unique unique (file_link_id),
  constraint file_link_retirements_actor_type_check check (created_by_type in ('human','agent','system'))
);
-- statement-breakpoint
create table if not exists file_processing_records (
  id text primary key,
  file_version_id text not null references file_versions(id) on delete restrict,
  processor_kind text not null,
  processor_name text not null,
  processor_version text not null,
  status text not null,
  input_hash text not null,
  output_refs jsonb not null default '[]'::jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint file_processing_records_status_check check (status in ('succeeded','failed')),
  constraint file_processing_records_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint file_processing_records_output_array_check check (jsonb_typeof(output_refs) = 'array'),
  constraint file_processing_records_success_output_check check (
    status <> 'succeeded' or jsonb_array_length(output_refs) > 0
  )
);
-- statement-breakpoint
create table if not exists file_upload_intents (
  id text primary key,
  project_id text not null references research_projects(id) on delete restrict,
  research_file_id text references research_files(id) on delete restrict,
  proposed_title text,
  file_kind text not null,
  access_class text not null,
  original_filename text not null,
  expected_byte_size bigint not null,
  declared_media_type text,
  change_summary text,
  state text not null default 'initiated',
  tus_upload_id text,
  quarantine_bucket text,
  quarantine_key text,
  created_by text not null references members(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_upload_intents_kind_check check (file_kind in (
    'literature','data_documentation','dataset','analysis_output','code_archive',
    'research_design','manuscript','review_material','meeting_note',
    'ethics_or_license','presentation','general_attachment'
  )),
  constraint file_upload_intents_access_class_check check (access_class in ('project','restricted')),
  constraint file_upload_intents_size_check check (expected_byte_size >= 0),
  constraint file_upload_intents_state_check check (state in (
    'initiated','uploading','uploaded_quarantine','scanning','rejected_malware',
    'accepted','metadata_processing','parsing','ready','ready_with_parse_error',
    'processing_failed'
  ))
);
-- statement-breakpoint
create unique index if not exists file_upload_intents_tus_upload_unique
  on file_upload_intents (tus_upload_id)
  where tus_upload_id is not null;
-- statement-breakpoint
create table if not exists file_ingest_processor_attempts (
  id text primary key,
  upload_intent_id text not null references file_upload_intents(id) on delete restrict,
  processor_kind text not null,
  processor_name text not null,
  processor_version text not null,
  input_hash text,
  status text not null default 'pending',
  output_refs jsonb not null default '[]'::jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_ingest_attempts_status_check check (status in ('pending','running','succeeded','failed')),
  constraint file_ingest_attempts_output_array_check check (jsonb_typeof(output_refs) = 'array')
);
-- statement-breakpoint
create unique index if not exists file_ingest_processor_attempts_dedupe
  on file_ingest_processor_attempts (
    upload_intent_id, processor_name, processor_version, coalesce(input_hash, '')
  );
-- statement-breakpoint
create table if not exists file_search_documents (
  file_version_id text primary key references file_versions(id) on delete cascade,
  research_file_id text not null references research_files(id) on delete cascade,
  project_id text not null references research_projects(id) on delete cascade,
  title text not null,
  original_filename text not null,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector not null default ''::tsvector,
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create index if not exists file_search_documents_vector_gin
  on file_search_documents using gin (search_vector);
-- statement-breakpoint
create or replace function reject_file_fact_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'file provenance facts are immutable and append-only';
end;
$$;
-- statement-breakpoint
drop trigger if exists file_versions_immutable on file_versions;
-- statement-breakpoint
create trigger file_versions_immutable
before update or delete on file_versions
for each row execute function reject_file_fact_mutation();
-- statement-breakpoint
drop trigger if exists external_data_references_immutable on external_data_references;
-- statement-breakpoint
create trigger external_data_references_immutable
before update or delete on external_data_references
for each row execute function reject_file_fact_mutation();
-- statement-breakpoint
drop trigger if exists file_links_immutable on file_links;
-- statement-breakpoint
create trigger file_links_immutable
before update or delete on file_links
for each row execute function reject_file_fact_mutation();
-- statement-breakpoint
drop trigger if exists file_link_retirements_immutable on file_link_retirements;
-- statement-breakpoint
create trigger file_link_retirements_immutable
before update or delete on file_link_retirements
for each row execute function reject_file_fact_mutation();
-- statement-breakpoint
drop trigger if exists file_processing_records_immutable on file_processing_records;
-- statement-breakpoint
create trigger file_processing_records_immutable
before update or delete on file_processing_records
for each row execute function reject_file_fact_mutation();
-- statement-breakpoint
create or replace function validate_research_file_current_version()
returns trigger
language plpgsql
as $$
begin
  if NEW.current_version_id is not null and not exists (
    select 1
    from file_versions v
    where v.id = NEW.current_version_id
      and v.research_file_id = NEW.id
  ) then
    raise exception 'current version must belong to the same research file';
  end if;
  return NEW;
end;
$$;
-- statement-breakpoint
drop trigger if exists research_files_current_version_same_file on research_files;
-- statement-breakpoint
create trigger research_files_current_version_same_file
before insert or update of current_version_id on research_files
for each row execute function validate_research_file_current_version();
