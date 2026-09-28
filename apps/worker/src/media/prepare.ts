/**
 * Turns a phone recording into the stored/analysed MP4.
 *
 *   1. repair broken fragment timing (iOS writes a negative sample duration after interruptions)
 *   2. remux (stream copy) when the phone already recorded H.264 + AAC: seconds instead of minutes.
 *      Railway's shared CPU re-encodes at only ~0.25-0.45x realtime, i.e. 10-20 min for a 45-min lesson,
 *      which would blow the 10-minute report target on its own.
 *   3. otherwise, or if the remuxed file fails validation, re-encode (H.264 720p, AAC)
 *
 * Every result is validated before it's accepted, so a corrupt file fails loudly instead of
 * producing a "months long" video downstream.
 */
import { rm } from "node:fs/promises";
import { MAX_RECORDING_MINUTES } from "@obs/shared";
import { normalize, probe, remux, type ProbeSummary } from "./ffmpeg.js";
import { repairFragmentedMp4, type TimingRepair } from "./fmp4.js";

export interface PreparedVideo {
  method: "remux" | "transcode";
  ms: number;
  realtimeFactor: number | null;
  repairs: TimingRepair[];
  source: ProbeSummary;
  output: ProbeSummary;
  /** why a remux was not used or was rejected, when a transcode happened */
  fallbackReason?: string;
}

/** Longest believable recording: the recording cap plus slack. */
const MAX_PLAUSIBLE_SEC = (MAX_RECORDING_MINUTES + 5) * 60;

export function validateOutput(p: ProbeSummary): string | null {
  if (!p.ok) return `unreadable output: ${p.error ?? "probe failed"}`;
  const d = p.durationSec;
  if (!d || !Number.isFinite(d) || d <= 0) return "output has no duration";
  if (d > MAX_PLAUSIBLE_SEC) return `output claims ${Math.round(d)}s, longer than any possible recording`;
  if (!p.video) return "output has no video stream";
  const v = p.video.durationSec;
  const a = p.audio?.durationSec;
  // audio and video should cover about the same span; a big mismatch means broken timestamps
  if (v && a && Math.abs(v - a) > Math.max(10, 0.05 * a)) return `video (${Math.round(v)}s) and audio (${Math.round(a)}s) lengths disagree`;
  return null;
}

function canStreamCopy(p: ProbeSummary): string | null {
  if (!p.ok || !p.video) return "source could not be probed";
  if (!/mp4|mov/.test(p.formatName ?? "")) return `container ${p.formatName} is not MP4`;
  if (p.video.codec !== "h264") return `video codec ${p.video.codec} is not H.264`;
  if (p.audio && p.audio.codec !== "aac") return `audio codec ${p.audio.codec} is not AAC`;
  if (Math.min(p.video.width, p.video.height) > 1080) return `resolution ${p.video.width}x${p.video.height} is above 1080p`;
  return null;
}

export async function prepareVideo(input: string, output: string): Promise<PreparedVideo> {
  const started = Date.now();
  let source = await probe(input);
  let repairs: TimingRepair[] = [];
  if (/mp4|mov/.test(source.formatName ?? "")) {
    const r = await repairFragmentedMp4(input);
    repairs = r.repairs;
    if (repairs.length) source = await probe(input);
  }

  let fallbackReason = canStreamCopy(source) ?? undefined;
  if (!fallbackReason) {
    const r = await remux(input, output);
    if (r.code === 0) {
      const out = await probe(output);
      const invalid = validateOutput(out);
      if (!invalid) return finish("remux", out);
      fallbackReason = `remuxed file rejected: ${invalid}`;
    } else {
      fallbackReason = `remux failed: ${r.stderr.trim().slice(-300)}`;
    }
    await rm(output, { force: true });
  }

  const t = await normalize(input, output);
  if (t.code !== 0) throw new Error(`video processing failed (${fallbackReason}); transcode error: ${t.stderr.trim().slice(-800)}`);
  const out = await probe(output);
  const invalid = validateOutput(out);
  if (invalid) throw new Error(`video processing produced an invalid file: ${invalid}`);
  return finish("transcode", out);

  function finish(method: PreparedVideo["method"], out: ProbeSummary): PreparedVideo {
    const ms = Date.now() - started;
    return {
      method,
      ms,
      realtimeFactor: out.durationSec ? Math.round((ms / 1000 / out.durationSec) * 1000) / 1000 : null,
      repairs,
      source,
      output: out,
      fallbackReason,
    };
  }
}
