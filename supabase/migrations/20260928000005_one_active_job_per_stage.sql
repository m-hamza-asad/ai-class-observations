-- Pipeline stages are triggered from several places (e.g. whichever of transcription or
-- normalization finishes last starts the report). This index makes "start stage X for recording Y"
-- idempotent: a second attempt to create a live row for the same stage fails and is skipped.
-- Failed rows are excluded, so a stage can be re-run after a failure.
create unique index processing_jobs_one_live_stage
  on public.processing_jobs (recording_id, stage)
  where recording_id is not null and status <> 'failed';
