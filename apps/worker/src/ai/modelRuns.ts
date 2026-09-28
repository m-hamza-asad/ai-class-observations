import type { Json } from "@obs/shared/database";
import { db } from "../lib/supabase.js";

export interface ModelRunInput {
  purpose: "transcription" | "romanization" | "video_analysis" | "report";
  provider: "groq" | "anthropic" | "google" | "fake";
  model: string;
  promptVersion: string;
  recordingId?: string;
  classId?: string;
  inputRefs?: Record<string, unknown>;
}

/**
 * Records every AI call that contributes to a stored artifact (inputs by reference, raw output,
 * token usage, latency), so a report stays auditable after its video is deleted.
 */
export async function recordModelRun(
  run: ModelRunInput,
  result: { output?: unknown; usage?: unknown; latencyMs: number; error?: string },
): Promise<string | null> {
  const { data, error } = await db()
    .from("model_runs")
    .insert({
      purpose: run.purpose,
      provider: run.provider,
      model: run.model,
      prompt_version: run.promptVersion,
      recording_id: run.recordingId ?? null,
      class_id: run.classId ?? null,
      input_refs: (run.inputRefs ?? {}) as { [key: string]: Json },
      output: (result.output ?? null) as Json,
      usage: (result.usage ?? null) as Json,
      latency_ms: result.latencyMs,
      error: result.error ?? null,
    })
    .select("id")
    .single();
  // auditing must never break the pipeline; a failed insert is logged by the caller's stage log
  return error ? null : data.id;
}
