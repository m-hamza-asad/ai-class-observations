-- Core schema for the lesson-observation POC.
-- Multi-campus is a filter, not a rebuild: every tenant-owned row carries campus_id (directly or via class),
-- and admin access is scoped to the admin's campus.
-- Writes that come from the pipeline (transcripts, analyses, reports, job status) are made by the worker
-- with the service-role key, which bypasses RLS; the policies below govern what browsers can do.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.app_role as enum ('teacher', 'admin');
create type public.document_type as enum ('planner', 'learning_outcomes', 'kpis', 'tors', 'other');
create type public.document_scope as enum ('class', 'recording');
create type public.parse_status as enum ('pending', 'processing', 'complete', 'failed');
create type public.rubric_status as enum ('pending', 'ready', 'failed');
create type public.recording_status as enum ('recording', 'uploading', 'processing', 'ready', 'failed');
create type public.recording_source as enum ('in_app', 'upload');
create type public.report_status as enum ('draft', 'final');
create type public.job_stage as enum (
  'upload', 'normalization', 'transcription', 'video_analysis', 'report_generation',
  'document_parse', 'rubric_derivation'
);
create type public.job_status as enum ('pending', 'processing', 'complete', 'failed');

-- ---------------------------------------------------------------------------------------------
-- Tenancy & people
-- ---------------------------------------------------------------------------------------------
create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- One row per auth user. Created by the admin invite flow (service role), never by the user,
-- so a user can't grant themselves a role.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null,
  campus_id uuid not null references public.campuses (id),
  invited_by uuid references public.profiles (id),
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.profiles (campus_id, role);

-- Admin-managed terms; a recording's video expiry defaults to its term's end date.
create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on)
);
create index on public.academic_terms (campus_id, starts_on);

-- ---------------------------------------------------------------------------------------------
-- Classes, documents, rubrics
-- ---------------------------------------------------------------------------------------------
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses (id),
  name text not null,
  subject text,
  grade text,
  teacher_id uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.classes (campus_id);
create index on public.classes (teacher_id);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses (id),
  class_id uuid not null references public.classes (id),
  teacher_id uuid not null references public.profiles (id),
  term_id uuid references public.academic_terms (id),
  status public.recording_status not null default 'recording',
  source public.recording_source not null,
  -- raw upload / stitched original, then the normalized H.264 MP4 used for playback and analysis
  original_path text,
  video_path text,
  video_deleted_at timestamptz,
  mime_type text,
  size_bytes bigint,
  duration_sec numeric,
  recorded_at timestamptz not null default now(),
  ended_at timestamptz,
  semester_expiry_date date,
  -- guardrail: set when another recording for the same teacher+class started shortly before this one
  possible_duplicate_of uuid references public.recordings (id),
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.recordings (teacher_id, recorded_at desc);
create index on public.recordings (class_id, recorded_at desc);
create index on public.recordings (campus_id, status);
create index on public.recordings (semester_expiry_date) where video_deleted_at is null;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  -- class-scoped docs (KPIs, TORs, learning outcomes) feed the rubric;
  -- recording-scoped docs (the day's lesson planner) feed only that lesson's report
  scope public.document_scope not null default 'class',
  recording_id uuid references public.recordings (id),
  type public.document_type not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  parsed_text text,
  parse_status public.parse_status not null default 'pending',
  parse_error text,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  -- documents are never hard-deleted (reports must stay auditable); removal marks them superseded
  superseded_at timestamptz,
  check ((scope = 'recording') = (recording_id is not null))
);
create index on public.documents (class_id) where superseded_at is null;
create index on public.documents (recording_id);

-- Every LLM/ASR call that contributes to a stored artifact, for auditability after videos are deleted.
create table public.model_runs (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,          -- e.g. 'rubric_derivation', 'transcription', 'romanization', 'video_analysis', 'report'
  provider text not null,         -- 'anthropic' | 'groq' | 'google'
  model text not null,
  prompt_version text,
  recording_id uuid references public.recordings (id),
  class_id uuid references public.classes (id),
  input_refs jsonb not null default '{}'::jsonb,  -- ids of documents / rubric / transcript used
  output jsonb,
  usage jsonb,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index on public.model_runs (recording_id);
create index on public.model_runs (class_id);

create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  version integer not null,
  status public.rubric_status not null default 'pending',
  structured_criteria jsonb,
  derived_from_document_ids uuid[] not null default '{}',
  model_run_id uuid references public.model_runs (id),
  error_detail text,
  created_at timestamptz not null default now(),
  unique (class_id, version)
);

-- ---------------------------------------------------------------------------------------------
-- Pipeline outputs
-- ---------------------------------------------------------------------------------------------
create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.recordings (id),
  full_text text not null default '',
  -- [{ start, end, text, text_original, confidence, is_flagged_unclear, language }]
  segments jsonb not null default '[]'::jsonb,
  model_run_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.recordings (id),
  -- [{ start, end, category, observation, evidence_strength }]
  findings jsonb not null default '[]'::jsonb,
  summary jsonb,
  model_run_id uuid references public.model_runs (id),
  created_at timestamptz not null default now()
);

-- Report layout is data, so the template can change without a deploy.
create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null,
  definition jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (name, version)
);
create unique index report_templates_one_active on public.report_templates (is_active) where is_active;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.recordings (id),
  rubric_id uuid references public.rubrics (id),
  template_id uuid references public.report_templates (id),
  sections jsonb not null default '[]'::jsonb,
  status public.report_status not null default 'draft',
  current_version integer not null default 1,
  model_run_id uuid references public.model_runs (id),
  finalized_by uuid references public.profiles (id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_edits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id),
  version integer not null,
  section_key text,
  edited_by uuid not null references public.profiles (id),
  previous_content jsonb,
  new_content jsonb,
  edited_at timestamptz not null default now(),
  unique (report_id, version)
);

-- User-visible status of every pipeline step (the queue itself is pg-boss, in its own schema).
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings (id),
  class_id uuid references public.classes (id),
  document_id uuid references public.documents (id),
  stage public.job_stage not null,
  status public.job_status not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  error_detail text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.processing_jobs (recording_id, stage);
create index on public.processing_jobs (document_id);
create index on public.processing_jobs (status) where status in ('pending', 'processing', 'failed');

-- ---------------------------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger touch before update on public.recordings for each row execute function public.touch_updated_at();
create trigger touch before update on public.transcripts for each row execute function public.touch_updated_at();
create trigger touch before update on public.reports for each row execute function public.touch_updated_at();
create trigger touch before update on public.processing_jobs for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS helpers (security definer so policies can read profiles without recursive RLS checks)
-- ---------------------------------------------------------------------------------------------
create function public.current_role_name() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and deactivated_at is null
$$;

create function public.current_campus_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select campus_id from public.profiles where id = auth.uid() and deactivated_at is null
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create function public.teaches_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.teacher_id = auth.uid()
  ) and public.current_role_name() = 'teacher'
$$;

create function public.owns_recording(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.recordings r where r.id = p_recording_id and r.teacher_id = auth.uid()
  ) and public.current_role_name() = 'teacher'
$$;

-- text variant for storage paths (no uuid cast, so a malformed object name can't raise an error)
create function public.owns_recording_path(p_recording_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.recordings r where r.id::text = p_recording_id and r.teacher_id = auth.uid()
  ) and public.current_role_name() = 'teacher'
$$;

create function public.admin_of_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists (
    select 1 from public.classes c where c.id = p_class_id and c.campus_id = public.current_campus_id()
  )
$$;

create function public.admin_of_recording(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists (
    select 1 from public.recordings r where r.id = p_recording_id and r.campus_id = public.current_campus_id()
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.campuses enable row level security;
alter table public.profiles enable row level security;
alter table public.academic_terms enable row level security;
alter table public.classes enable row level security;
alter table public.recordings enable row level security;
alter table public.documents enable row level security;
alter table public.model_runs enable row level security;
alter table public.rubrics enable row level security;
alter table public.transcripts enable row level security;
alter table public.video_analyses enable row level security;
alter table public.report_templates enable row level security;
alter table public.reports enable row level security;
alter table public.report_edits enable row level security;
alter table public.processing_jobs enable row level security;

-- campuses
create policy "members read own campus" on public.campuses for select to authenticated
  using (id = public.current_campus_id());

-- profiles: everyone reads their own row; admins read/update their campus.
-- Inserts happen only through the service-role invite flow.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "admins read campus profiles" on public.profiles for select to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id());
create policy "admins update campus profiles" on public.profiles for update to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id())
  with check (public.is_admin() and campus_id = public.current_campus_id());

-- academic_terms
create policy "members read terms" on public.academic_terms for select to authenticated
  using (campus_id = public.current_campus_id());
create policy "admins manage terms" on public.academic_terms for all to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id())
  with check (public.is_admin() and campus_id = public.current_campus_id());

-- classes
create policy "admins manage classes" on public.classes for all to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id())
  with check (public.is_admin() and campus_id = public.current_campus_id());
create policy "teachers read own classes" on public.classes for select to authenticated
  using (teacher_id = auth.uid() and public.current_role_name() = 'teacher');

-- recordings: teachers create and read their own; status changes come from the worker.
create policy "admins read campus recordings" on public.recordings for select to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id());
create policy "admins update campus recordings" on public.recordings for update to authenticated
  using (public.is_admin() and campus_id = public.current_campus_id())
  with check (public.is_admin() and campus_id = public.current_campus_id());
create policy "teachers read own recordings" on public.recordings for select to authenticated
  using (teacher_id = auth.uid() and public.current_role_name() = 'teacher');
create policy "teachers create own recordings" on public.recordings for insert to authenticated
  with check (
    teacher_id = auth.uid()
    and public.teaches_class(class_id)
    and campus_id = public.current_campus_id()
  );

-- documents
create policy "admins manage documents" on public.documents for all to authenticated
  using (public.admin_of_class(class_id))
  with check (public.admin_of_class(class_id));
create policy "teachers read own class documents" on public.documents for select to authenticated
  using (public.teaches_class(class_id));
create policy "teachers attach planner to own recording" on public.documents for insert to authenticated
  with check (
    scope = 'recording' and type = 'planner'
    and public.owns_recording(recording_id)
    and public.teaches_class(class_id)
    and uploaded_by = auth.uid()
  );

-- rubrics
create policy "admins read rubrics" on public.rubrics for select to authenticated
  using (public.admin_of_class(class_id));
create policy "teachers read own class rubrics" on public.rubrics for select to authenticated
  using (public.teaches_class(class_id));

-- model_runs: admin audit only
create policy "admins read model runs" on public.model_runs for select to authenticated
  using (
    public.is_admin() and (
      (recording_id is not null and public.admin_of_recording(recording_id))
      or (class_id is not null and public.admin_of_class(class_id))
    )
  );

-- transcripts & video analyses: admins; teachers only once their report is final
create policy "admins read transcripts" on public.transcripts for select to authenticated
  using (public.admin_of_recording(recording_id));
create policy "teachers read transcripts of final reports" on public.transcripts for select to authenticated
  using (
    public.owns_recording(recording_id)
    and exists (select 1 from public.reports r where r.recording_id = transcripts.recording_id and r.status = 'final')
  );
create policy "admins read video analyses" on public.video_analyses for select to authenticated
  using (public.admin_of_recording(recording_id));

-- report templates
create policy "members read templates" on public.report_templates for select to authenticated using (true);

-- reports: admins read/edit (edits go through the save_report_edit function); teachers read their final reports
create policy "admins read reports" on public.reports for select to authenticated
  using (public.admin_of_recording(recording_id));
create policy "teachers read own final reports" on public.reports for select to authenticated
  using (status = 'final' and public.owns_recording(recording_id));

create policy "admins read report edits" on public.report_edits for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id and public.admin_of_recording(r.recording_id)));

-- processing jobs: admins see everything in campus, teachers see progress on their own recordings
create policy "admins read jobs" on public.processing_jobs for select to authenticated
  using (
    (recording_id is not null and public.admin_of_recording(recording_id))
    or (class_id is not null and public.admin_of_class(class_id))
    or (document_id is not null and exists (
      select 1 from public.documents d where d.id = document_id and public.admin_of_class(d.class_id)))
  );
create policy "teachers read own recording jobs" on public.processing_jobs for select to authenticated
  using (recording_id is not null and public.owns_recording(recording_id));

-- ---------------------------------------------------------------------------------------------
-- Storage buckets (private). Paths: {campus_id}/{class_id}/... for documents,
-- {campus_id}/{recording_id}/... for recordings. Video bytes are written by the worker.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('documents', 'documents', false, 26214400),        -- 25 MB
  ('recordings', 'recordings', false, 5368709120)     -- 5 GB
on conflict (id) do nothing;

create policy "admins upload campus documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents' and public.is_admin()
    and (storage.foldername(name))[1] = public.current_campus_id()::text
  );
create policy "admins read campus documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and public.is_admin()
    and (storage.foldername(name))[1] = public.current_campus_id()::text
  );
create policy "admins read campus recordings" on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings' and public.is_admin()
    and (storage.foldername(name))[1] = public.current_campus_id()::text
  );
create policy "teachers read own recordings" on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings'
    and public.owns_recording_path((storage.foldername(name))[2])
  );
create policy "teachers upload own recordings" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and public.owns_recording_path((storage.foldername(name))[2])
  );
