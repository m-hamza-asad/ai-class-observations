/**
 * Live chunk ingest for a recording (the production version of what the recording lab validated).
 *
 * MediaRecorder chunks are only playable when concatenated in order, so each recording has one
 * growing "stream" file on the worker's volume. Chunks may arrive out of order or twice (client
 * retries); they're stored individually and appended once contiguous. Every ~60s of *media time*
 * an audio slice is cut from the growing file for rolling transcription.
 *
 * Scale note: state lives on this worker's disk, so a recording must be served by one worker
 * instance (fine for the POC and a single Railway service). Scaling out means sticky routing by
 * recording id or moving chunk storage to object storage.
 */
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { MAX_RECORDING_MINUTES, MAX_UPLOAD_BYTES, TRANSCRIPTION_SLICE_SECONDS } from "@obs/shared";
import { config } from "../config.js";
import { extractAudioSlice, probe } from "../media/ffmpeg.js";

const ROOT = path.resolve(config.DATA_DIR, "recordings");
/** Each slice starts this many seconds before the previous one ended, so a word cut at the boundary is heard whole. */
export const SLICE_OVERLAP_SEC = 2;
const MAX_CHUNK_BYTES = 200 * 1024 ** 2;

export class IngestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SliceCut {
  index: number;
  /** Segments starting (by midpoint) before this belong to the previous slice. */
  logicalStartSec: number;
  /** Where the audio file actually starts in recording time (logicalStart minus overlap). */
  extractFromSec: number;
  durationSec: number;
  file: string;
}

interface IngestMeta {
  id: string;
  teacherId: string;
  ext: string;
  received: Record<string, { bytes: number; tMs: number | null }>;
  appendedUpTo: number;
  appendedBytes: number;
  lastSliceAtMs: number;
  nextSliceIndex: number;
  audioCursorSec: number;
  finishedTotal: number | null;
}

export const dirOf = (id: string) => path.join(ROOT, id);
const metaPath = (id: string) => path.join(dirOf(id), "meta.json");
const chunkPath = (id: string, seq: number) => path.join(dirOf(id), "chunks", `${String(seq).padStart(6, "0")}.bin`);
export const streamPath = (m: Pick<IngestMeta, "id" | "ext">) => path.join(dirOf(m.id), `stream.${m.ext}`);

async function load(id: string): Promise<IngestMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}
const save = (m: IngestMeta) => writeFile(metaPath(m.id), JSON.stringify(m));

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  return next;
}

export function extForMime(mime: string | undefined): string {
  if (mime?.includes("mp4")) return "mp4";
  if (mime?.includes("webm")) return "webm";
  if (mime?.includes("quicktime")) return "mov";
  return "bin";
}

export async function initIngest(id: string, teacherId: string, mimeType: string | undefined) {
  return withLock(id, async () => {
    const existing = await load(id);
    if (existing) return existing;
    await mkdir(path.join(dirOf(id), "chunks"), { recursive: true });
    const m: IngestMeta = {
      id,
      teacherId,
      ext: extForMime(mimeType),
      received: {},
      appendedUpTo: 0,
      appendedBytes: 0,
      lastSliceAtMs: 0,
      nextSliceIndex: 0,
      audioCursorSec: 0,
      finishedTotal: null,
    };
    await save(m);
    return m;
  });
}

export async function ingestOwner(id: string): Promise<string | null> {
  return (await load(id))?.teacherId ?? null;
}

function limitBytes(max: number) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      cb(seen > max ? new IngestError(413, "chunk too large") : null, chunk);
    },
  });
}

/** Store one chunk, append whatever is now contiguous, and cut any audio slices that are due. */
export async function receiveChunk(id: string, seq: number, body: Readable, tMs: number | null) {
  if (tMs !== null && tMs > (MAX_RECORDING_MINUTES + 2) * 60_000) {
    throw new IngestError(413, `recording exceeds the ${MAX_RECORDING_MINUTES}-minute limit`);
  }
  // write outside the lock (network-bound); rename makes the chunk visible atomically
  const target = chunkPath(id, seq);
  const tmp = `${target}.${process.pid}.${Date.now()}.part`;
  await pipeline(body, limitBytes(MAX_CHUNK_BYTES), createWriteStream(tmp));
  await rename(tmp, target);
  const bytes = (await stat(target)).size;

  return withLock(id, async () => {
    const m = await load(id);
    if (!m) throw new IngestError(404, "unknown recording");
    if (m.finishedTotal !== null && seq > m.finishedTotal) throw new IngestError(409, "recording already finished");
    const duplicate = Boolean(m.received[String(seq)]);
    // a retried chunk that was already appended: drop the new copy
    if (duplicate && seq <= m.appendedUpTo) await rm(chunkPath(id, seq), { force: true });
    if (!duplicate) m.received[String(seq)] = { bytes, tMs };

    const slices: SliceCut[] = [];
    while (m.received[String(m.appendedUpTo + 1)]) {
      const next = m.appendedUpTo + 1;
      if (m.appendedBytes > MAX_UPLOAD_BYTES) throw new IngestError(413, "recording exceeds the maximum size");
      const buf = await readFile(chunkPath(id, next));
      await appendFile(streamPath(m), buf);
      // the stream file now holds these bytes; keeping the chunk too would double disk use
      await rm(chunkPath(id, next), { force: true });
      m.appendedUpTo = next;
      m.appendedBytes += buf.length;
      const t = m.received[String(next)].tMs;
      if (t !== null && t - m.lastSliceAtMs >= TRANSCRIPTION_SLICE_SECONDS * 1000) {
        const cut = await cutSlice(m);
        if (cut) slices.push(cut);
        m.lastSliceAtMs = t;
      }
    }
    await save(m);
    return { duplicate, bytes, appendedUpTo: m.appendedUpTo, appendedBytes: m.appendedBytes, received: Object.keys(m.received).length, slices };
  });
}

/** Cut the audio added since the last slice (plus a small overlap). Returns null if nothing new is decodable yet. */
async function cutSlice(m: IngestMeta): Promise<SliceCut | null> {
  const extractFromSec = Math.max(0, m.audioCursorSec - SLICE_OVERLAP_SEC);
  const index = m.nextSliceIndex;
  const file = path.join(dirOf(m.id), "audio", `slice-${String(index).padStart(4, "0")}.flac`);
  await mkdir(path.dirname(file), { recursive: true });
  const r = await extractAudioSlice(streamPath(m), file, extractFromSec);
  if (r.code !== 0) throw new Error(`audio slice extraction failed: ${r.stderr.trim().slice(-500)}`);
  const durationSec = (await probe(file)).durationSec ?? 0;
  const newAudio = extractFromSec + durationSec - m.audioCursorSec;
  if (newAudio < 1) {
    await rm(file, { force: true });
    return null;
  }
  const cut: SliceCut = { index, logicalStartSec: m.audioCursorSec, extractFromSec, durationSec, file };
  m.audioCursorSec = extractFromSec + durationSec;
  m.nextSliceIndex++;
  return cut;
}

/** Called when the teacher stops. Returns missing chunk numbers, or the final audio slice (if any audio remains). */
export async function finishIngest(id: string, totalChunks: number) {
  return withLock(id, async () => {
    const m = await load(id);
    if (!m) throw new IngestError(404, "unknown recording");
    const missing = Array.from({ length: totalChunks }, (_, i) => i + 1).filter((s) => !m.received[String(s)]);
    if (missing.length) return { missing, finalSlice: null, meta: m };
    if (m.finishedTotal !== null) return { missing: [], finalSlice: null, meta: m, alreadyFinished: true };
    if (m.appendedUpTo !== totalChunks) throw new Error(`append pointer ${m.appendedUpTo} != total ${totalChunks}`);
    const finalSlice = await cutSlice(m);
    m.finishedTotal = totalChunks;
    await save(m);
    return { missing: [], finalSlice, meta: m };
  });
}

export async function ingestStreamFile(id: string): Promise<string> {
  const m = await load(id);
  if (!m) throw new Error(`no ingest state for recording ${id}`);
  return streamPath(m);
}

/** Free the worker's disk once the pipeline no longer needs the local copies. */
export async function cleanupIngest(id: string) {
  await rm(dirOf(id), { recursive: true, force: true });
}
