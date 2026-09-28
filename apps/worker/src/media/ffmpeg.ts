import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Resolve ffmpeg/ffprobe binaries. Production (Docker) sets FFMPEG_PATH / FFPROBE_PATH
 * to the system binaries; local dev falls back to the ffmpeg-static / ffprobe-static packages.
 */
function resolveBinary(envVar: string, pkg: string, pick: (mod: any) => string | null): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  try {
    const p = pick(require(pkg));
    if (p) return p;
  } catch {
    // package not installed (e.g. production image) — fall through to PATH
  }
  return envVar === "FFMPEG_PATH" ? "ffmpeg" : "ffprobe";
}

export const FFMPEG = resolveBinary("FFMPEG_PATH", "ffmpeg-static", (m) => m);
export const FFPROBE = resolveBinary("FFPROBE_PATH", "ffprobe-static", (m) => m.path);

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

export function run(bin: string, args: string[], timeoutMs = 30 * 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    // keep only the tail of stderr; ffmpeg can be very chatty on long inputs
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

export interface ProbeSummary {
  ok: boolean;
  formatName?: string;
  durationSec?: number;
  sizeBytes?: number;
  bitRate?: number;
  video?: { codec: string; width: number; height: number; fps?: string; rotation?: number; durationSec?: number };
  audio?: { codec: string; sampleRate: number; channels: number; durationSec?: number };
  error?: string;
}

const num = (x: unknown) => (Number.isFinite(Number(x)) && x !== undefined && x !== null ? Number(x) : undefined);

export async function probe(file: string): Promise<ProbeSummary> {
  const r = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 120_000);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim().slice(-2000) || `ffprobe exited ${r.code}` };
  const j = JSON.parse(r.stdout);
  const v = j.streams?.find((s: any) => s.codec_type === "video");
  const a = j.streams?.find((s: any) => s.codec_type === "audio");
  const dur = Number(j.format?.duration);
  const rotation = v?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? (v?.tags?.rotate ? Number(v.tags.rotate) : undefined);
  return {
    ok: true,
    formatName: j.format?.format_name,
    durationSec: Number.isFinite(dur) ? dur : undefined,
    sizeBytes: Number(j.format?.size) || undefined,
    bitRate: Number(j.format?.bit_rate) || undefined,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: v.avg_frame_rate, rotation, durationSec: num(v.duration) } : undefined,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels, durationSec: num(a.duration) } : undefined,
  };
}

/**
 * Decode-based duration, used when container metadata has none
 * (MediaRecorder WebM output and growing fragmented MP4 often report no duration).
 */
export async function decodedDurationSec(file: string, stream: "a" | "v" = "a"): Promise<number | undefined> {
  const r = await run(FFMPEG, ["-v", "error", "-stats", "-i", file, "-map", `0:${stream}:0`, "-f", "null", "-"], 10 * 60_000);
  const matches = [...r.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  if (!last) return undefined;
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

/**
 * Extract a mono 16 kHz FLAC slice starting at `fromSec` — the format we'll send to Whisper.
 * FLAC keeps a 10-minute slice well under Groq's upload limit.
 */
export async function extractAudioSlice(input: string, output: string, fromSec: number): Promise<RunResult> {
  return run(FFMPEG, ["-v", "error", "-y", "-ss", String(fromSec), "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", output], 5 * 60_000);
}

/**
 * Repackage without re-encoding (seconds, not minutes). Used when the phone already recorded H.264 + AAC,
 * which both iOS Safari and Android Chrome do. faststart puts the index first so playback starts immediately.
 */
export async function remux(input: string, output: string): Promise<RunResult> {
  return run(FFMPEG, ["-v", "error", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", output]);
}

/**
 * Normalize any phone recording to the canonical storage/analysis format:
 * H.264 (max 720p, max 30fps) + AAC mono, faststart MP4. Also applies rotation metadata.
 */
export async function normalize(input: string, output: string): Promise<RunResult> {
  return run(FFMPEG, [
    "-v", "error", "-y", "-i", input,
    // cap the short side at 720 px (landscape or portrait); rotation is applied before filters
    "-vf", "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
    "-fpsmax", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "1",
    "-movflags", "+faststart",
    output,
  ]);
}
