/**
 * Recording pipeline, one pg-boss queue per stage:
 *
 *   chunks arrive ──► transcribe-slice (rolling, per ~60s of audio, while the lesson is still going)
 *   teacher stops ──► final slice + normalize-recording
 *   all slices done ──► assemble-transcript
 *   transcript + normalized video (+ video analysis, once built) ──► generate-report ──► recording "ready"
 *
 * Every stage is idempotent and mirrored in processing_jobs; the unique index on live
 * (recording, stage) rows means whichever upstream stage finishes last starts the next one exactly once.
 */
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Database, Json } from "@obs/shared/database";
import type { FrameworkDefinition } from "@obs/shared";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { db } from "../lib/supabase.js";
import { prepareVideo } from "../media/prepare.js";
import { cleanupIngest, dirOf, ingestStreamFile, type SliceCut } from "../recordings/ingest.js";
import { isUnclear, segmentConfidence, transcribeSlice, TRANSCRIBE_PROMPT_VERSION } from "../ai/transcribe.js";
import { needsRomanization, romanize, ROMANIZE_PROMPT_VERSION } from "../ai/romanize.js";
import { generateReport, REPORT_PROMPT_VERSION } from "../ai/report.js";
import { recordModelRun } from "../ai/modelRuns.js";
import { QUEUES, send } from "../queue/boss.js";
import { PermanentError, runTracked } from "./tracking.js";

type Stage = Database["public"]["Enums"]["job_stage"];

/** Stored transcript segment (recording time, Roman Urdu text). */
export interface Segment {
  start: number;
  end: number;
  text: string;
  text_original: string | null;
  confidence: number;
  is_flagged_unclear: boolean;
  language: string | null;
}

/** If more than this share of slices fail, the transcript is too incomplete to report on. */
const MAX_FAILED_SLICE_SHARE = 0.2;

// ------------------------------------------------------------------------------------------------
// Stage bookkeeping
// ------------------------------------------------------------------------------------------------

/** Creates the live processing_jobs row for a stage, or returns null if one already exists. */
async function startStage(recordingId: string, stage: Stage, maxAttempts: number): Promise<string | null> {
  const { data, error } = await db().from("processing_jobs").insert({ recording_id: recordingId, stage, max_attempts: maxAttempts }).select("id").single();
  if (error?.code === "23505") return null; // unique live (recording, stage): already started
  if (error) throw error;
  return data.id;
}

async function stageRow(recordingId: string, stage: Stage) {
  const { data } = await db()
    .from("processing_jobs")
    .select("id, status")
    .eq("recording_id", recordingId)
    .eq("stage", stage)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function failRecording(recordingId: string, stage: Stage, message: string) {
  await db().from("recordings").update({ status: "failed", error_detail: `${stage}: ${message}` }).eq("id", recordingId);
}

// ------------------------------------------------------------------------------------------------
// Enqueue helpers (called from the HTTP routes)
// ------------------------------------------------------------------------------------------------

export async function enqueueSlices(recordingId: string, cuts: SliceCut[]) {
  for (const cut of cuts) {
    const { data, error } = await db()
      .from("transcription_slices")
      .upsert({ recording_id: recordingId, slice_index: cut.index, start_sec: cut.logicalStartSec, duration_sec: cut.durationSec, status: "pending" }, { onConflict: "recording_id,slice_index" })
      .select("id")
      .single();
    if (error) throw error;
    await send("transcribeSlice", { recordingId, sliceId: data.id, index: cut.index, file: cut.file, extractFromSec: cut.extractFromSec, logicalStartSec: cut.logicalStartSec } satisfies SliceJob);
    logger.info({ stage: "transcription", recordingId, slice: cut.index, fromSec: cut.logicalStartSec, durationSec: cut.durationSec }, "slice enqueued");
  }
  // the transcription stage is "processing" from the first slice until the transcript is assembled
  if (cuts.length) {
    const row = await startStage(recordingId, "transcription", QUEUES.assembleTranscript.retryLimit + 1);
    if (row) await db().from("processing_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", row);
  }
}

export async function onRecordingFinished(recordingId: string) {
  const row = await startStage(recordingId, "normalization", QUEUES.normalize.retryLimit + 1);
  if (row) await send("normalize", { recordingId, jobRowId: row } satisfies StageJob);
  await checkTranscriptionComplete(recordingId);
}

// ------------------------------------------------------------------------------------------------
// transcribe-slice
// ------------------------------------------------------------------------------------------------

export interface SliceJob {
  recordingId: string;
  sliceId: string;
  index: number;
  file: string;
  extractFromSec: number;
  logicalStartSec: number;
}

export async function handleTranscribeSlice(job: SliceJob, retryCount: number, retryLimit: number) {
  const attempt = retryCount + 1;
  const ctx = { stage: "transcription", recordingId: job.recordingId, slice: job.index, attempt, maxAttempts: retryLimit + 1 };
  await db().from("transcription_slices").update({ status: "processing", attempt_count: attempt, error_detail: null }).eq("id", job.sliceId);
  const started = Date.now();
  try {
    const result = await transcribeSlice(job.file);
    const asrRun = await recordModelRun(
      { purpose: "transcription", provider: result.provider, model: result.model, promptVersion: TRANSCRIBE_PROMPT_VERSION, recordingId: job.recordingId, inputRefs: { slice_index: job.index, extract_from_sec: job.extractFromSec } },
      { output: { language: result.language, segments: result.segments }, latencyMs: result.latencyMs },
    );

    // shift into recording time; drop the overlap that the previous slice already covered
    let segments: Segment[] = result.segments
      .map((s) => ({ ...s, start: s.start + job.extractFromSec, end: s.end + job.extractFromSec }))
      .filter((s) => job.index === 0 || (s.start + s.end) / 2 >= job.logicalStartSec)
      .map((s) => ({
        start: round2(s.start),
        end: round2(s.end),
        text: s.text,
        text_original: null,
        confidence: round2(segmentConfidence(s)),
        is_flagged_unclear: isUnclear(s, config.UNCLEAR_CONFIDENCE_THRESHOLD),
        language: result.language,
      }));

    const runIds = [asrRun].filter(Boolean) as string[];
    const toRomanize = segments.map((s, i) => ({ i, text: s.text })).filter((l) => needsRomanization(l.text));
    if (toRomanize.length) {
      const rom = await romanize(toRomanize);
      const romRun = await recordModelRun(
        { purpose: "romanization", provider: rom.provider, model: rom.model, promptVersion: ROMANIZE_PROMPT_VERSION, recordingId: job.recordingId, inputRefs: { slice_index: job.index, lines: toRomanize.length } },
        { output: Object.fromEntries(rom.romanized), usage: rom.usage, latencyMs: rom.latencyMs },
      );
      if (romRun) runIds.push(romRun);
      segments = segments.map((s, i) => (rom.romanized.has(i) ? { ...s, text: rom.romanized.get(i)!, text_original: s.text } : s));
    }

    await db()
      .from("transcription_slices")
      .update({ status: "complete", segments: segments as unknown as Json[], language: result.language, model_run_ids: runIds })
      .eq("id", job.sliceId);
    logger.info({ ...ctx, ms: Date.now() - started, segments: segments.length, romanized: toRomanize.length, unclear: segments.filter((s) => s.is_flagged_unclear).length }, "slice transcribed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = err instanceof PermanentError || attempt > retryLimit;
    await db()
      .from("transcription_slices")
      .update({ status: final ? "failed" : "pending", error_detail: final ? message : `attempt ${attempt} failed, retrying: ${message}` })
      .eq("id", job.sliceId);
    logger[final ? "error" : "warn"]({ ...ctx, error: message, final }, final ? "slice failed" : "slice attempt failed, will retry");
    if (!final) throw err;
  }
  await checkTranscriptionComplete(job.recordingId);
}

/** Once the lesson has ended and every slice has settled, assemble the transcript. */
async function checkTranscriptionComplete(recordingId: string) {
  const { data: rec } = await db().from("recordings").select("ended_at").eq("id", recordingId).single();
  if (!rec?.ended_at) return;
  const { data: open } = await db().from("transcription_slices").select("id").eq("recording_id", recordingId).in("status", ["pending", "processing"]).limit(1);
  if (open?.length) return;
  // singletonKey collapses concurrent triggers; assembly itself is idempotent
  await send("assembleTranscript", { recordingId } satisfies { recordingId: string }, { singletonKey: recordingId });
}

// ------------------------------------------------------------------------------------------------
// assemble-transcript
// ------------------------------------------------------------------------------------------------

export async function handleAssembleTranscript(data: { recordingId: string }, retryCount: number, retryLimit: number) {
  const { recordingId } = data;
  let row = await stageRow(recordingId, "transcription");
  if (!row || row.status === "failed") {
    // no audio slices were ever cut (e.g. a few seconds of recording): create the stage row now
    const id = await startStage(recordingId, "transcription", retryLimit + 1);
    row = id ? { id, status: "pending" } : await stageRow(recordingId, "transcription");
  }
  if (!row || row.status === "complete") return;

  await runTracked(
    { stage: "transcription", recordingId },
    { jobRowId: row.id, retryCount, retryLimit },
    async () => {
      const { data: slices, error } = await db().from("transcription_slices").select("*").eq("recording_id", recordingId).order("slice_index");
      if (error) throw error;
      if (!slices?.length) throw new PermanentError("No audio was captured, so there is nothing to transcribe.");
      const failed = slices.filter((s) => s.status === "failed");
      if (failed.length / slices.length > MAX_FAILED_SLICE_SHARE) {
        throw new PermanentError(`${failed.length} of ${slices.length} audio slices could not be transcribed. First error: ${failed[0].error_detail ?? "unknown"}`);
      }

      const segments: Segment[] = [];
      for (const s of slices) {
        if (s.status === "complete") segments.push(...((s.segments as unknown as Segment[]) ?? []));
        else {
          // keep the gap visible instead of silently dropping a minute of the lesson
          segments.push({
            start: Number(s.start_sec),
            end: Number(s.start_sec) + Number(s.duration_sec ?? 60),
            text: "[Transcription unavailable for this part of the recording]",
            text_original: null,
            confidence: 0,
            is_flagged_unclear: true,
            language: null,
          });
        }
      }
      segments.sort((a, b) => a.start - b.start);
      const fullText = segments.map((s) => s.text).join("\n");
      const runIds = slices.flatMap((s) => s.model_run_ids);
      const { error: upErr } = await db()
        .from("transcripts")
        .upsert({ recording_id: recordingId, full_text: fullText, segments: segments as unknown as Json[], model_run_ids: runIds }, { onConflict: "recording_id" });
      if (upErr) throw upErr;
      logger.info({ stage: "transcription", recordingId, segments: segments.length, unclear: segments.filter((s) => s.is_flagged_unclear).length, failedSlices: failed.length }, "transcript assembled");
    },
    (msg) => failRecording(recordingId, "transcription", msg),
  );
  await maybeStartReport(recordingId);
}

// ------------------------------------------------------------------------------------------------
// normalize-recording
// ------------------------------------------------------------------------------------------------

export interface StageJob {
  recordingId: string;
  jobRowId: string;
}

export async function handleNormalize(data: StageJob, retryCount: number, retryLimit: number) {
  const { recordingId } = data;
  await runTracked(
    { stage: "normalization", recordingId },
    { jobRowId: data.jobRowId, retryCount, retryLimit },
    async () => {
      const { data: rec, error } = await db().from("recordings").select("id, campus_id").eq("id", recordingId).single();
      if (error || !rec) throw new Error(`recording ${recordingId} not found`);
      const src = await ingestStreamFile(recordingId);
      const out = path.join(dirOf(recordingId), "lesson.mp4");
      // repair browser timing bugs, then remux (or transcode as a fallback); output is validated inside
      const prepared = await prepareVideo(src, out);
      const p = prepared.output;
      if (!p.durationSec) throw new Error("processed video has no duration");

      const storagePath = `${rec.campus_id}/${recordingId}/lesson.mp4`;
      const size = (await stat(out)).size;
      const { error: upErr } = await db()
        .storage.from("recordings")
        .upload(storagePath, await openAsBlob(out, { type: "video/mp4" }), { contentType: "video/mp4", upsert: true });
      if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
      await db()
        .from("recordings")
        .update({ video_path: storagePath, duration_sec: Math.round(p.durationSec * 10) / 10, size_bytes: size, mime_type: "video/mp4" })
        .eq("id", recordingId);
      logger.info(
        {
          stage: "normalization",
          recordingId,
          method: prepared.method,
          fallbackReason: prepared.fallbackReason,
          timingRepairs: prepared.repairs,
          durationSec: p.durationSec,
          bytes: size,
          ms: prepared.ms,
        },
        "video processed and stored",
      );
    },
    (msg) => failRecording(recordingId, "normalization", msg),
  );
  await maybeStartReport(recordingId);
}

// ------------------------------------------------------------------------------------------------
// generate-report
// ------------------------------------------------------------------------------------------------

/** Starts the report once the transcript and normalized video exist. Safe to call from any stage. */
async function maybeStartReport(recordingId: string) {
  const [transcription, normalization] = await Promise.all([stageRow(recordingId, "transcription"), stageRow(recordingId, "normalization")]);
  if (transcription?.status !== "complete" || normalization?.status !== "complete") return;
  // Video analysis (Gemini) is added in the next build step; until then the report runs on the transcript.
  const row = await startStage(recordingId, "report_generation", QUEUES.generateReport.retryLimit + 1);
  if (row) {
    await send("generateReport", { recordingId, jobRowId: row } satisfies StageJob);
    logger.info({ stage: "report_generation", recordingId, jobId: row }, "enqueued");
  }
}

export async function handleGenerateReport(data: StageJob, retryCount: number, retryLimit: number) {
  const { recordingId } = data;
  await runTracked(
    { stage: "report_generation", recordingId },
    { jobRowId: data.jobRowId, retryCount, retryLimit },
    async () => {
      const sb = db();
      const { data: rec, error } = await sb.from("recordings").select("*, classes!inner(id, name, subject, grade)").eq("id", recordingId).single();
      if (error || !rec) throw new Error(`recording ${recordingId} not found: ${error?.message}`);

      const { data: existing } = await sb.from("reports").select("id, status, current_version").eq("recording_id", recordingId).maybeSingle();
      if (existing && (existing.status === "final" || existing.current_version > 1)) {
        // never overwrite a report an administrator has edited or finalized
        logger.warn({ stage: "report_generation", recordingId }, "report already edited/finalized; not regenerating");
        return;
      }

      const [{ data: template }, { data: transcript }, { data: docs }, { data: analysis }] = await Promise.all([
        sb.from("report_templates").select("id, version, definition").eq("is_active", true).single(),
        sb.from("transcripts").select("id, segments").eq("recording_id", recordingId).single(),
        sb.from("documents").select("id, type, scope, file_name, parse_status, parsed_text").eq("class_id", rec.class_id).is("superseded_at", null).or(`scope.eq.class,recording_id.eq.${recordingId}`),
        sb.from("video_analyses").select("id, findings").eq("recording_id", recordingId).maybeSingle(),
      ]);
      if (!template) throw new PermanentError("No active report template/framework is configured.");
      if (!transcript) throw new Error("transcript missing");

      const planners = (docs ?? []).filter((d) => d.scope === "recording" && d.type === "planner");
      if (planners.some((p) => p.parse_status === "pending" || p.parse_status === "processing")) {
        throw new Error("lesson planner is still being processed; will retry"); // retryable: wait for the parse
      }
      const planner = planners.find((p) => p.parse_status === "complete" && p.parsed_text);
      const classDocs = (docs ?? []).filter((d) => d.scope === "class" && d.parse_status === "complete" && d.parsed_text);
      const definition = template.definition as unknown as FrameworkDefinition;

      const result = await generateReport({
        definition,
        lesson: {
          className: rec.classes.name,
          subject: rec.classes.subject,
          grade: rec.classes.grade,
          durationSec: Number(rec.duration_sec ?? 0),
          recordedAt: new Date(rec.recorded_at).toISOString(),
        },
        transcript: (transcript.segments as unknown as Segment[]).map((s) => ({ start: s.start, end: s.end, text: s.text, is_flagged_unclear: s.is_flagged_unclear })),
        videoFindings: (analysis?.findings as unknown as { start_sec: number; end_sec: number | null; category: string; observation: string }[] | null) ?? null,
        classDocuments: classDocs.map((d) => ({ type: d.type, fileName: d.file_name, text: d.parsed_text! })),
        planner: planner ? { fileName: planner.file_name, text: planner.parsed_text! } : null,
      });

      const runId = await recordModelRun(
        {
          purpose: "report",
          provider: result.provider,
          model: result.model,
          promptVersion: REPORT_PROMPT_VERSION,
          recordingId,
          classId: rec.class_id,
          inputRefs: {
            template_id: template.id,
            template_version: template.version,
            transcript_id: transcript.id,
            video_analysis_id: analysis?.id ?? null,
            planner_document_id: planner?.id ?? null,
            class_document_ids: classDocs.map((d) => d.id),
          },
        },
        { output: { draft: result.draft, warnings: result.warnings }, usage: result.usage, latencyMs: result.latencyMs },
      );

      const { error: upErr } = await sb.from("reports").upsert(
        {
          recording_id: recordingId,
          template_id: template.id,
          sections: result.draft as unknown as { [key: string]: Json },
          scores: result.scores as unknown as Json,
          status: "draft",
          current_version: 1,
          model_run_id: runId,
        },
        { onConflict: "recording_id" },
      );
      if (upErr) throw upErr;
      await sb.from("recordings").update({ status: "ready", error_detail: null }).eq("id", recordingId);
      logger.info(
        { stage: "report_generation", recordingId, rubricPercent: result.scores.rubric_percent, alignmentPercent: result.scores.alignment_percent, notObserved: result.scores.not_observed.length, warnings: result.warnings.length },
        "draft report stored",
      );
    },
    (msg) => failRecording(recordingId, "report_generation", msg),
  );

  const final = await stageRow(recordingId, "report_generation");
  if (final?.status === "complete") await cleanupIngest(recordingId).catch(() => undefined);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
