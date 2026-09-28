/**
 * processing_jobs is the user-visible record of every pipeline step; pg-boss is the actual queue.
 * Each attempt updates the row (attempt_count, status, error_detail) and logs a structured line,
 * and exhausting retries leaves a clear 'failed' row instead of a silently stuck item.
 */
import type { Database } from "@obs/shared/database";
import { db } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

type Stage = Database["public"]["Enums"]["job_stage"];

/** Thrown for failures a retry can't fix (unsupported file, empty document): fail now, don't retry. */
export class PermanentError extends Error {}

export interface JobRef {
  stage: Stage;
  recordingId?: string;
  documentId?: string;
  classId?: string;
}

export async function createJobRow(ref: JobRef, maxAttempts: number): Promise<string> {
  const { data, error } = await db()
    .from("processing_jobs")
    .insert({
      stage: ref.stage,
      recording_id: ref.recordingId ?? null,
      document_id: ref.documentId ?? null,
      class_id: ref.classId ?? null,
      max_attempts: maxAttempts,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

interface AttemptInfo {
  jobRowId: string;
  retryCount: number; // 0 on the first attempt
  retryLimit: number;
}

/**
 * Runs one attempt of a tracked job. Rethrows retryable errors so pg-boss schedules the retry;
 * swallows PermanentError (and the final retryable failure is reported via onFinalFailure).
 */
export async function runTracked(
  ref: JobRef,
  attempt: AttemptInfo,
  fn: () => Promise<void>,
  onFinalFailure?: (message: string) => Promise<void>,
) {
  const attemptNo = attempt.retryCount + 1;
  const maxAttempts = attempt.retryLimit + 1;
  const ctx = { stage: ref.stage, jobId: attempt.jobRowId, recordingId: ref.recordingId, documentId: ref.documentId, classId: ref.classId, attempt: attemptNo, maxAttempts };
  const started = Date.now();
  await db()
    .from("processing_jobs")
    .update({ status: "processing", attempt_count: attemptNo, started_at: new Date().toISOString(), error_detail: null })
    .eq("id", attempt.jobRowId);
  logger.info(ctx, "stage started");

  try {
    await fn();
    await db().from("processing_jobs").update({ status: "complete", finished_at: new Date().toISOString() }).eq("id", attempt.jobRowId);
    logger.info({ ...ctx, ms: Date.now() - started }, "stage complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentError;
    const final = permanent || attemptNo >= maxAttempts;
    await db()
      .from("processing_jobs")
      .update({
        status: final ? "failed" : "pending",
        error_detail: final ? message : `attempt ${attemptNo}/${maxAttempts} failed, retrying: ${message}`,
        finished_at: final ? new Date().toISOString() : null,
      })
      .eq("id", attempt.jobRowId);
    logger[final ? "error" : "warn"]({ ...ctx, ms: Date.now() - started, error: message, permanent, final }, final ? "stage failed" : "stage attempt failed, will retry");
    if (final) await onFinalFailure?.(message);
    if (!permanent && !final) throw err;
  }
}
