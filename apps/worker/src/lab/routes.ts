/**
 * Recording lab: throwaway endpoints used to validate in-browser recording on real devices
 * before the production pipeline is built. Mirrors the production ingest design:
 *   - chunks arrive in order-agnostic PUTs, are appended to a growing "stream" file once contiguous
 *   - every ~60s of appended media we cut a Whisper-ready FLAC slice from the growing file
 *     (proves rolling transcription works on partial MediaRecorder output)
 *   - on finalize we probe, decode and normalize the full file and time each step
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { decodedDurationSec, extractAudioSlice, normalize, probe, type ProbeSummary } from "../media/ffmpeg.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data", "lab");
const MAX_UPLOAD_BYTES = Number(process.env.LAB_MAX_UPLOAD_BYTES ?? 4 * 1024 ** 3);
const RETENTION_HOURS = Number(process.env.LAB_RETENTION_HOURS ?? 72);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

interface AudioSlice {
  afterSeq: number;
  fromSec: number;
  durationSec?: number;
  ms: number;
  ok: boolean;
  error?: string;
}

interface Analysis {
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  sourceProbe?: ProbeSummary;
  decodedAudioSec?: number;
  normalizeMs?: number;
  normalizeRealtimeFactor?: number;
  normalizedProbe?: ProbeSummary;
  error?: string;
}

interface LabMeta {
  id: string;
  source: "recorder" | "upload";
  createdAt: string;
  mimeType?: string;
  userAgent?: string;
  timesliceMs?: number;
  fileName?: string;
  ext: string;
  sliceEveryMs: number;
  lastSliceAtMs: number;
  received: Record<string, { bytes: number; at: string; tMs?: number }>;
  appendedUpTo: number;
  appendedBytes: number;
  audioSlices: AudioSlice[];
  audioCursorSec: number;
  finalizedAt?: string;
  expectedChunks?: number;
  missingChunks?: number[];
  analysis?: Analysis;
  clientReport?: unknown;
}

const dirOf = (id: string) => path.join(DATA_DIR, id);
const metaPath = (id: string) => path.join(dirOf(id), "meta.json");
const streamPath = (m: LabMeta) => path.join(dirOf(m.id), `stream.${m.ext}`);
const chunkPath = (id: string, seq: number) => path.join(dirOf(id), "chunks", `${String(seq).padStart(6, "0")}.bin`);

async function loadMeta(id: string): Promise<LabMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}
const saveMeta = (m: LabMeta) => writeFile(metaPath(m.id), JSON.stringify(m, null, 2));

/** Serialize all work on one session (appends, slicing, finalize) so meta.json never races. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  return next;
}

function extFor(mime?: string, fileName?: string): string {
  const fromName = fileName?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mime?.includes("mp4")) return "mp4";
  if (mime?.includes("webm")) return "webm";
  if (mime?.includes("quicktime")) return "mov";
  return "bin";
}

function limitBytes(max: number) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new Error(`upload exceeds ${max} bytes`));
      else cb(null, chunk);
    },
  });
}

function checkToken(req: FastifyRequest): boolean {
  const expected = process.env.LAB_TOKEN;
  if (!expected) return true;
  const got = req.headers["x-lab-token"] ?? (req.query as Record<string, string>)?.token;
  return got === expected;
}

/** Append every contiguous chunk to the stream file; cut an audio slice every N chunks. */
async function appendContiguous(m: LabMeta, log: FastifyInstance["log"]) {
  while (m.received[String(m.appendedUpTo + 1)]) {
    const seq = m.appendedUpTo + 1;
    const buf = await readFile(chunkPath(m.id, seq));
    await appendFile(streamPath(m), buf);
    m.appendedUpTo = seq;
    m.appendedBytes += buf.length;
    // slice on media time (chunk capture offset), not chunk count: browsers emit chunks at uneven rates
    const tMs = m.received[String(seq)].tMs;
    if (tMs !== undefined && tMs - m.lastSliceAtMs >= m.sliceEveryMs) {
      await cutAudioSlice(m, log);
      m.lastSliceAtMs = tMs;
    }
  }
}

async function cutAudioSlice(m: LabMeta, log: FastifyInstance["log"]) {
  const out = path.join(dirOf(m.id), "audio", `slice-${String(m.appendedUpTo).padStart(6, "0")}.flac`);
  await mkdir(path.dirname(out), { recursive: true });
  const r = await extractAudioSlice(streamPath(m), out, m.audioCursorSec);
  const slice: AudioSlice = { afterSeq: m.appendedUpTo, fromSec: m.audioCursorSec, ms: r.ms, ok: r.code === 0 };
  if (r.code === 0) {
    const p = await probe(out);
    slice.durationSec = p.durationSec;
    if (p.durationSec) m.audioCursorSec += p.durationSec;
    else slice.ok = false;
  } else {
    slice.error = r.stderr.trim().slice(-1000);
  }
  m.audioSlices.push(slice);
  log.info({ lab: m.id, stage: "audio_slice", ...slice }, "lab audio slice");
}

async function analyze(id: string, log: FastifyInstance["log"]) {
  const m = await loadMeta(id);
  if (!m) return;
  const a: Analysis = { status: "running", startedAt: new Date().toISOString() };
  m.analysis = a;
  await saveMeta(m);
  try {
    const src = streamPath(m);
    a.sourceProbe = await probe(src);
    a.decodedAudioSec = await decodedDurationSec(src, "a");
    const out = path.join(dirOf(id), "normalized.mp4");
    const n = await normalize(src, out);
    if (n.code !== 0) throw new Error(`normalize failed: ${n.stderr.trim().slice(-1500)}`);
    a.normalizeMs = n.ms;
    a.normalizedProbe = await probe(out);
    const dur = a.normalizedProbe.durationSec ?? a.decodedAudioSec;
    if (dur) a.normalizeRealtimeFactor = Number((n.ms / 1000 / dur).toFixed(3));
    a.status = "done";
  } catch (err) {
    a.status = "failed";
    a.error = err instanceof Error ? err.message : String(err);
  }
  a.finishedAt = new Date().toISOString();
  await withLock(id, async () => {
    const latest = (await loadMeta(id)) ?? m;
    latest.analysis = a;
    await saveMeta(latest);
  });
  log.info({ lab: id, stage: "analysis", status: a.status, error: a.error, normalizeMs: a.normalizeMs }, "lab analysis finished");
}

async function cleanupOld(log: FastifyInstance["log"]) {
  const cutoff = Date.now() - RETENTION_HOURS * 3600_000;
  let entries: string[] = [];
  try {
    entries = await readdir(DATA_DIR);
  } catch {
    return;
  }
  for (const id of entries) {
    const s = await stat(dirOf(id)).catch(() => null);
    if (s && s.mtimeMs < cutoff) {
      await rm(dirOf(id), { recursive: true, force: true });
      log.info({ lab: id, stage: "retention" }, "deleted expired lab session");
    }
  }
}

export async function labRoutes(app: FastifyInstance) {
  await mkdir(DATA_DIR, { recursive: true });
  setInterval(() => void cleanupOld(app.log), 3600_000).unref();

  // Raw binary bodies are handed to the route as a stream; we enforce our own size cap.
  const passthrough = (_req: FastifyRequest, payload: Readable, done: (err: Error | null, body?: unknown) => void) => done(null, payload);
  app.addContentTypeParser("application/octet-stream", passthrough);
  app.addContentTypeParser(/^(video|audio)\//, passthrough);

  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "OPTIONS" && !checkToken(req)) return reply.code(401).send({ error: "bad lab token" });
  });

  app.post<{ Body: { id: string; mimeType?: string; userAgent?: string; timesliceMs?: number; sliceEverySec?: number } }>(
    "/sessions",
    async (req, reply) => {
      const { id, mimeType, userAgent, timesliceMs, sliceEverySec = 60 } = req.body ?? ({} as never);
      if (!ID_RE.test(id ?? "")) return reply.code(400).send({ error: "invalid id" });
      const existing = await loadMeta(id);
      if (existing) return existing; // idempotent: client may retry after a network drop
      await mkdir(path.join(dirOf(id), "chunks"), { recursive: true });
      const m: LabMeta = {
        id,
        source: "recorder",
        createdAt: new Date().toISOString(),
        mimeType,
        userAgent,
        timesliceMs,
        ext: extFor(mimeType),
        sliceEveryMs: sliceEverySec * 1000,
        lastSliceAtMs: 0,
        received: {},
        appendedUpTo: 0,
        appendedBytes: 0,
        audioSlices: [],
        audioCursorSec: 0,
      };
      await saveMeta(m);
      req.log.info({ lab: id, stage: "session_created", mimeType, userAgent }, "lab session created");
      return m;
    },
  );

  app.put<{ Params: { id: string; seq: string } }>("/sessions/:id/chunks/:seq", async (req, reply) => {
    const { id } = req.params;
    const seq = Number(req.params.seq);
    if (!ID_RE.test(id) || !Number.isInteger(seq) || seq < 1) return reply.code(400).send({ error: "bad id/seq" });
    if (!(await loadMeta(id))) return reply.code(404).send({ error: "unknown session" });

    // write to a temp file first so a dropped connection never leaves a truncated chunk behind
    const target = chunkPath(id, seq);
    const tmp = `${target}.part`;
    await pipeline(req.body as Readable, limitBytes(200 * 1024 ** 2), createWriteStream(tmp));
    await rename(tmp, target);
    const bytes = (await stat(target)).size;

    return withLock(id, async () => {
      const m = (await loadMeta(id))!;
      const duplicate = Boolean(m.received[String(seq)]);
      const tMs = Number(req.headers["x-chunk-t"]);
      if (!duplicate) m.received[String(seq)] = { bytes, at: new Date().toISOString(), tMs: Number.isFinite(tMs) ? tMs : undefined };
      await appendContiguous(m, req.log);
      await saveMeta(m);
      req.log.info({ lab: id, stage: "chunk", seq, bytes, duplicate, appendedUpTo: m.appendedUpTo }, "lab chunk");
      return { seq, bytes, duplicate, appendedUpTo: m.appendedUpTo, lastSlice: m.audioSlices.at(-1) ?? null };
    });
  });

  app.post<{ Params: { id: string }; Body: { totalChunks: number } }>("/sessions/:id/finalize", async (req, reply) => {
    const { id } = req.params;
    const total = Number(req.body?.totalChunks);
    const m0 = await loadMeta(id);
    if (!m0) return reply.code(404).send({ error: "unknown session" });
    if (m0.analysis && m0.analysis.status !== "failed") return m0; // idempotent
    const m = await withLock(id, async () => {
      const m = (await loadMeta(id))!;
      m.expectedChunks = total;
      m.missingChunks = Array.from({ length: total }, (_, i) => i + 1).filter((s) => !m.received[String(s)]);
      if (m.missingChunks.length === 0) {
        // final audio slice covers whatever the rolling slices haven't yet
        if (m.audioSlices.at(-1)?.afterSeq !== m.appendedUpTo) await cutAudioSlice(m, req.log);
        m.finalizedAt = new Date().toISOString();
      }
      await saveMeta(m);
      return m;
    });
    if (m.missingChunks?.length) return reply.code(409).send({ error: "missing chunks", missing: m.missingChunks });
    req.log.info({ lab: id, stage: "finalize", totalChunks: total, bytes: m.appendedBytes }, "lab finalize");
    void analyze(id, req.log);
    return m;
  });

  // Fallback-path test: a native camera file uploaded in one request (raw body).
  app.put<{ Params: { id: string } }>("/uploads/:id", async (req, reply) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return reply.code(400).send({ error: "invalid id" });
    if (await loadMeta(id)) return reply.code(409).send({ error: "id already used" });
    const fileName = String(req.headers["x-file-name"] ?? "upload");
    const mimeType = String(req.headers["content-type"] ?? "");
    await mkdir(dirOf(id), { recursive: true });
    const m: LabMeta = {
      id,
      source: "upload",
      createdAt: new Date().toISOString(),
      mimeType,
      userAgent: req.headers["user-agent"],
      fileName,
      ext: extFor(mimeType, fileName),
      sliceEveryMs: 0,
      lastSliceAtMs: 0,
      received: {},
      appendedUpTo: 0,
      appendedBytes: 0,
      audioSlices: [],
      audioCursorSec: 0,
    };
    const started = Date.now();
    try {
      await pipeline(req.body as Readable, limitBytes(MAX_UPLOAD_BYTES), createWriteStream(streamPath(m)));
    } catch (err) {
      await rm(dirOf(id), { recursive: true, force: true });
      req.log.warn({ lab: id, stage: "upload", error: String(err) }, "lab upload failed");
      return reply.code(413).send({ error: String(err) });
    }
    m.appendedBytes = (await stat(streamPath(m))).size;
    m.finalizedAt = new Date().toISOString();
    await saveMeta(m);
    req.log.info({ lab: id, stage: "upload", bytes: m.appendedBytes, ms: Date.now() - started }, "lab upload received");
    void analyze(id, req.log);
    return m;
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/report", async (req, reply) => {
    const { id } = req.params;
    if (!(await loadMeta(id))) return reply.code(404).send({ error: "unknown session" });
    return withLock(id, async () => {
      const m = (await loadMeta(id))!;
      m.clientReport = req.body;
      await saveMeta(m);
      return { ok: true };
    });
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const m = await loadMeta(req.params.id);
    return m ?? reply.code(404).send({ error: "unknown session" });
  });

  app.get("/sessions", async () => {
    const ids = await readdir(DATA_DIR).catch(() => [] as string[]);
    const metas = (await Promise.all(ids.map(loadMeta))).filter((m): m is LabMeta => Boolean(m));
    return metas
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => ({
        id: m.id,
        source: m.source,
        createdAt: m.createdAt,
        mimeType: m.mimeType,
        userAgent: m.userAgent,
        chunks: Object.keys(m.received).length,
        bytes: m.appendedBytes,
        finalized: Boolean(m.finalizedAt),
        analysis: m.analysis?.status,
        durationSec: m.analysis?.normalizedProbe?.durationSec,
      }));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/normalized", async (req, reply) => {
    const file = path.join(dirOf(req.params.id), "normalized.mp4");
    if (!ID_RE.test(req.params.id) || !(await stat(file).catch(() => null))) return reply.code(404).send({ error: "not ready" });
    reply.header("content-type", "video/mp4");
    return reply.send(createReadStream(file));
  });
}
