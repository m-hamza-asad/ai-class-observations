/**
 * On-phone persistence for lesson recordings. Every chunk is written to IndexedDB before any upload
 * attempt, so a dropped connection, closed tab or crash never loses video; the uploader drains it.
 * Chunks are stored as ArrayBuffer (older iOS Safari was unreliable with Blobs in IndexedDB).
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface LocalRecording {
  id: string;
  classId: string;
  className: string;
  mimeType: string;
  timesliceMs: number;
  startedAt: number;
  stoppedAt?: number;
  totalChunks?: number;
  /** server confirmed every chunk and started processing */
  finished?: boolean;
  plannerUploaded?: boolean;
}

export interface LocalChunk {
  recordingId: string;
  seq: number;
  data: ArrayBuffer;
  bytes: number;
  capturedAt: number;
  uploaded: 0 | 1;
}

interface RecDB extends DBSchema {
  recordings: { key: string; value: LocalRecording };
  chunks: { key: [string, number]; value: LocalChunk; indexes: { byRecording: string; pending: [string, number] } };
}

let dbp: Promise<IDBPDatabase<RecDB>> | null = null;
function db() {
  dbp ??= openDB<RecDB>("lesson-recordings", 1, {
    upgrade(d) {
      d.createObjectStore("recordings", { keyPath: "id" });
      const c = d.createObjectStore("chunks", { keyPath: ["recordingId", "seq"] });
      c.createIndex("byRecording", "recordingId");
      c.createIndex("pending", ["recordingId", "uploaded"]);
    },
  });
  return dbp;
}

export const saveRecording = async (r: LocalRecording) => void (await (await db()).put("recordings", r));
export const getRecording = async (id: string) => (await db()).get("recordings", id);
export const listRecordings = async () => (await (await db()).getAll("recordings")).sort((a, b) => b.startedAt - a.startedAt);
export const putChunk = async (c: LocalChunk) => void (await (await db()).put("chunks", c));

export async function nextPendingChunk(recordingId: string) {
  const rows = await (await db()).getAllFromIndex("chunks", "pending", [recordingId, 0]);
  return rows.sort((a, b) => a.seq - b.seq)[0];
}

export async function setChunkUploaded(recordingId: string, seq: number, uploaded: 0 | 1) {
  const d = await db();
  const tx = d.transaction("chunks", "readwrite");
  const row = await tx.store.get([recordingId, seq]);
  if (row) await tx.store.put({ ...row, uploaded });
  await tx.done;
}

export async function chunkCounts(recordingId: string) {
  let count = 0,
    uploaded = 0,
    bytes = 0,
    pendingBytes = 0;
  let cursor = await (await db()).transaction("chunks").store.index("byRecording").openCursor(recordingId);
  while (cursor) {
    count++;
    bytes += cursor.value.bytes;
    if (cursor.value.uploaded) uploaded++;
    else pendingBytes += cursor.value.bytes;
    cursor = await cursor.continue();
  }
  return { count, uploaded, bytes, pendingBytes };
}

/** Once the server has everything, drop the video bytes from the phone but keep a small record. */
export async function deleteChunks(recordingId: string) {
  const d = await db();
  const tx = d.transaction("chunks", "readwrite");
  let cursor = await tx.store.index("byRecording").openCursor(recordingId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
