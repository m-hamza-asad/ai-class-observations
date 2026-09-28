/**
 * Whisper large-v3 on Groq, one ~60s audio slice at a time.
 * Returns segments in *slice* time; the caller shifts them into recording time.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import Groq, { toFile } from "groq-sdk";
import { aiFake, config } from "../config.js";
import { PermanentError } from "../jobs/tracking.js";

export const TRANSCRIBE_PROMPT_VERSION = "whisper-bilingual-v1";

/**
 * Whisper's prompt biases spelling and style, not content. A short code-switched sample in Roman Urdu
 * nudges it to keep mixed English/Urdu speech as spoken instead of translating it.
 */
const BILINGUAL_PROMPT =
  "Assalam o alaikum class. Aaj hum chapter five parhenge. Open your books, page number twenty. Samajh aaya? Yes miss. Bohat acha, very good. Ab chain reading karein.";

export interface RawSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
  compression_ratio: number;
}

export interface SliceTranscript {
  language: string | null;
  segments: RawSegment[];
  model: string;
  provider: "groq" | "fake";
  latencyMs: number;
}

let groq: Groq | null = null;

export async function transcribeSlice(file: string): Promise<SliceTranscript> {
  if (aiFake) return fakeTranscribe();
  if (!config.GROQ_API_KEY) throw new PermanentError("GROQ_API_KEY is not configured on the worker.");
  groq ??= new Groq({ apiKey: config.GROQ_API_KEY, maxRetries: 2, timeout: 120_000 });

  const started = Date.now();
  const upload = await toFile(await readFile(file), path.basename(file), { type: "audio/flac" });
  // verbose_json carries per-segment timing and log-probs; the SDK's return type only declares `text`
  const res = (await groq.audio.transcriptions.create({
    file: upload,
    model: config.WHISPER_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    temperature: 0,
    prompt: BILINGUAL_PROMPT,
  })) as unknown as { language?: string; segments?: RawSegment[] };

  return {
    language: res.language ?? null,
    segments: (res.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      avg_logprob: s.avg_logprob,
      no_speech_prob: s.no_speech_prob,
      compression_ratio: s.compression_ratio,
    })),
    model: config.WHISPER_MODEL,
    provider: "groq",
    latencyMs: Date.now() - started,
  };
}

// Well-known Whisper hallucinations on silence or noise; never trust them as speech.
const HALLUCINATIONS = [/thank(s| you) for watching/i, /subscribe/i, /subtitles by/i, /amara\.org/i, /^\W*$/];

/** Whisper has no true confidence score; exp(avg_logprob) is the usual per-segment proxy. */
export function segmentConfidence(s: RawSegment): number {
  return Math.max(0, Math.min(1, Math.exp(s.avg_logprob)));
}

export function isUnclear(s: RawSegment, threshold: number): boolean {
  const confidence = segmentConfidence(s);
  return (
    confidence < threshold ||
    (s.no_speech_prob > 0.6 && confidence < 0.6) || // probably silence/noise transcribed as words
    s.compression_ratio > 2.4 || // repetitive output: a classic Whisper failure loop
    HALLUCINATIONS.some((re) => re.test(s.text))
  );
}

/** Deterministic fake for local pipeline testing (AI_FAKE=1). Includes Urdu script and a low-confidence line. */
function fakeTranscribe(): SliceTranscript {
  return {
    language: "ur",
    provider: "fake",
    model: "fake-whisper",
    latencyMs: 5,
    segments: [
      { start: 0.5, end: 6, text: "Good morning class, open your books to page twenty.", avg_logprob: -0.15, no_speech_prob: 0.01, compression_ratio: 1.3 },
      { start: 6.2, end: 12, text: "آج ہم chapter five پڑھیں گے، سمجھ آیا؟", avg_logprob: -0.35, no_speech_prob: 0.02, compression_ratio: 1.2 },
      { start: 12.5, end: 20, text: "Yes miss.", avg_logprob: -0.4, no_speech_prob: 0.05, compression_ratio: 1.0 },
      { start: 21, end: 30, text: "[inaudible chatter]", avg_logprob: -1.6, no_speech_prob: 0.7, compression_ratio: 1.1 },
      { start: 31, end: 58, text: "Ayesha, please start the chain reading from paragraph two. Loudly and clearly.", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.4 },
    ],
  };
}
