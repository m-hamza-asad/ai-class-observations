/**
 * IndexedDB persistence for recording chunks. Every MediaRecorder chunk is written here
 * before any upload attempt, so a dropped connection, tab reload or crash never loses video.
 * Chunks are stored as ArrayBuffer (not Blob) — older iOS Safari builds were unreliable with Blobs in IDB.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface LabSessionRow {
  id: string;
  createdAt: number;
  mimeType: string;
  timesliceMs: number;
  stoppedAt?: number;
  totalChunks?: number;
  finalizedOnServer?: boolean;
  events: LabEvent[];
}

export interface LabChunkRow {
  sessionId: string;
  seq: number;
  data: ArrayBuffer;
  bytes: number;
  capturedAt: number;
  uploaded: 0 | 1;
}

export interface LabEvent {
  t: number; // ms since session start
  at: number; // epoch ms
  type: string;
  detail?: string;
}

interface LabDB extends DBSchema {
  sessions: { key: string; value: LabSessionRow };
  chunks: {
    key: [string, number];
    value: LabChunkRow;
    indexes: { bySession: string; pending: [string, number] };
  };
}

let dbp: Promise<IDBPDatabase<LabDB>> | null = null;

export function db() {
  dbp ??= openDB<LabDB>("lab-recorder", 1, {
    upgrade(d) {
      d.createObjectStore("sessions", { keyPath: "id" });
      const c = d.createObjectStore("chunks", { keyPath: ["sessionId", "seq"] });
      c.createIndex("bySession", "sessionId");
      c.createIndex("pending", ["sessionId", "uploaded"]);
    },
  });
  return dbp;
}

export async function putSession(s: LabSessionRow) {
  await (await db()).put("sessions", s);
}

export async function getSession(id: string) {
  return (await db()).get("sessions", id);
}

export async function listSessions() {
  const all = await (await db()).getAll("sessions");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putChunk(c: LabChunkRow) {
  await (await db()).put("chunks", c);
}

export async function markUploaded(sessionId: string, seq: number) {
  const d = await db();
  const tx = d.transaction("chunks", "readwrite");
  const row = await tx.store.get([sessionId, seq]);
  if (row) await tx.store.put({ ...row, uploaded: 1 });
  await tx.done;
}

/** Lowest-seq chunk not yet uploaded, or undefined. */
export async function nextPending(sessionId: string) {
  const d = await db();
  const rows = await d.getAllFromIndex("chunks", "pending", [sessionId, 0]);
  return rows.sort((a, b) => a.seq - b.seq)[0];
}

export async function chunkStats(sessionId: string) {
  const d = await db();
  let count = 0,
    bytes = 0,
    uploaded = 0;
  let cursor = await d.transaction("chunks").store.index("bySession").openCursor(sessionId);
  while (cursor) {
    count++;
    bytes += cursor.value.bytes;
    uploaded += cursor.value.uploaded;
    cursor = await cursor.continue();
  }
  return { count, bytes, uploaded };
}

export async function assemble(sessionId: string, mimeType: string) {
  const rows = await (await db()).getAllFromIndex("chunks", "bySession", sessionId);
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(rows.map((r) => r.data), { type: mimeType.split(";")[0] });
}

export async function deleteSession(id: string) {
  const d = await db();
  const tx = d.transaction(["sessions", "chunks"], "readwrite");
  await tx.objectStore("sessions").delete(id);
  let cursor = await tx.objectStore("chunks").index("bySession").openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
