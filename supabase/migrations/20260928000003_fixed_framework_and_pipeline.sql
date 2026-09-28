-- Day 3: the school's observation rubric is a fixed, versioned framework (stored in the report
-- template), not something derived per class. Adds pipeline tables for rolling transcription.

-- ---------------------------------------------------------------------------------------------
-- 1. Remove per-class rubric derivation
-- ---------------------------------------------------------------------------------------------
alter table public.reports drop column rubric_id;
drop table public.rubrics;
drop type public.rubric_status;
-- 'rubric_derivation' stays in the job_stage enum (Postgres can't drop enum values cheaply); unused.

-- Reports pin the template version they were scored against (template_id already exists)
-- and keep the computed scores in a column for listing/filtering.
alter table public.reports add column scores jsonb;
-- scores: { rubric_percent, alignment_percent, categories: { <key>: percent|null } }

-- ---------------------------------------------------------------------------------------------
-- 2. Placeholder for future comparative audits (AI report vs human observer). No logic yet.
-- ---------------------------------------------------------------------------------------------
create table public.human_observer_reports (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id),
  observer_role text,
  content jsonb,
  uploaded_at timestamptz not null default now()
);
alter table public.human_observer_reports enable row level security;
create policy "admins read observer reports" on public.human_observer_reports for select to authenticated
  using (public.admin_of_recording(recording_id));

-- ---------------------------------------------------------------------------------------------
-- 3. Rolling transcription: one row per audio slice cut while the lesson is still recording
-- ---------------------------------------------------------------------------------------------
create table public.transcription_slices (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id),
  slice_index integer not null,
  start_sec numeric not null,
  duration_sec numeric,
  status public.job_status not null default 'pending',
  attempt_count integer not null default 0,
  -- [{ start, end, text, text_original, confidence, is_flagged_unclear, language }] in recording time
  segments jsonb,
  language text,
  model_run_ids uuid[] not null default '{}',
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id, slice_index)
);
create trigger touch before update on public.transcription_slices for each row execute function public.touch_updated_at();
alter table public.transcription_slices enable row level security;
create policy "admins read slices" on public.transcription_slices for select to authenticated
  using (public.admin_of_recording(recording_id));

-- ingest progress, so admins can see a lesson arriving and diagnose stalled uploads
alter table public.recordings
  add column chunks_received integer not null default 0,
  add column bytes_received bigint not null default 0,
  add column last_chunk_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- 4. Teachers may parse the lesson planner they attach to their own recording
--    (upload policy for teacher planners already exists on public.documents)
-- ---------------------------------------------------------------------------------------------
create policy "teachers upload planner for own recording" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_campus_id()::text
    and public.owns_recording_path((storage.foldername(name))[3])
  );
