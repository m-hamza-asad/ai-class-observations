/**
 * Live chunk uploader (validated in the recording lab): drains IndexedDB in order while the lesson
 * is still being recorded, retries with backoff, resumes the moment the phone is back online, and
 * finalizes once recording has stopped and the server has every chunk.
 */
import { createClient } from "@/lib/supabase/client";
import { WORKER_URL } from "@/lib/supabase/env";
import { chunkCounts, deleteChunks, getRecording, nextPendingChunk, saveRecording, setChunkUploaded } from "./store";

export type UploadState = "uploading" | "caught_up" | "offline" | "retrying" | "finishing" | "done" | "error";

export interface UploadStatus {
  state: UploadState;
  pendingChunks: number;
  uploadedChunks: number;
  totalChunks: number;
  pendingBytes: number;
  lastError?: string;
  lastSuccessAt?: number;
  serverCreated: boolean;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`${status} ${body.slice(0, 200)}`);
  }
}

export class RecordingUploader {
  private wake: (() => void) | null = null;
  private stopped = false;
  private failures = 0;
  status: UploadStatus = { state: "uploading", pendingChunks: 0, uploadedChunks: 0, totalChunks: 0, pendingBytes: 0, serverCreated: false };

  constructor(
    private recordingId: string,
    private onChange: (s: UploadStatus) => void,
    private onEvent: (type: string, detail?: string) => void = () => undefined,
  ) {}

  poke = () => this.wake?.();

  start() {
    window.addEventListener("online", this.poke);
    void this.loop();
    return this;
  }

  dispose() {
    this.stopped = true;
    window.removeEventListener("online", this.poke);
    this.poke();
  }

  private async req(path: string, init: RequestInit & { headers?: Record<string, string> }, timeoutMs = 90_000) {
    const { data } = await createClient().auth.getSession(); // refreshes an expired token when online
    const token = data.session?.access_token;
    if (!token) throw new HttpError(401, "signed out");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${WORKER_URL}/recordings${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, signal: ctrl.signal });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }

  private async refresh(state?: UploadState) {
    const rec = await getRecording(this.recordingId);
    const c = await chunkCounts(this.recordingId);
    this.status = {
      ...this.status,
      state: state ?? this.status.state,
      pendingChunks: c.count - c.uploaded,
      uploadedChunks: c.uploaded,
      totalChunks: rec?.totalChunks ?? c.count,
      pendingBytes: c.pendingBytes,
    };
    this.onChange({ ...this.status });
  }

  private async loop() {
    await this.refresh();
    while (!this.stopped) {
      try {
        const rec = await getRecording(this.recordingId);
        if (!rec) return;
        if (rec.finished) {
          await this.refresh("done");
          return;
        }
        if (!this.status.serverCreated) {
          await this.req("", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: rec.id, classId: rec.classId, mimeType: rec.mimeType, startedAt: new Date(rec.startedAt).toISOString() }),
          });
          this.status.serverCreated = true;
          this.onEvent("server-created");
        }
        const chunk = await nextPendingChunk(this.recordingId);
        if (chunk) {
          await this.req(`/${rec.id}/chunks/${chunk.seq}`, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream", "x-chunk-t": String(chunk.capturedAt - rec.startedAt) },
            body: chunk.data,
          });
          await setChunkUploaded(rec.id, chunk.seq, 1);
          this.succeeded();
          await this.refresh(rec.totalChunks ? "finishing" : "uploading");
          continue;
        }
        if (rec.totalChunks) {
          await this.refresh("finishing");
          try {
            await this.req(`/${rec.id}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ totalChunks: rec.totalChunks }) });
          } catch (err) {
            // the server is missing chunks we thought were uploaded (e.g. worker restarted mid-request): resend them
            if (err instanceof HttpError && err.status === 409) {
              const missing = (JSON.parse(err.body).missing ?? []) as number[];
              for (const seq of missing) await setChunkUploaded(rec.id, seq, 0);
              this.onEvent("resending", `${missing.length} parts`);
              continue;
            }
            throw err;
          }
          await saveRecording({ ...rec, finished: true });
          await deleteChunks(rec.id); // the server has the full video; free the phone's storage
          this.onEvent("finished");
          await this.refresh("done");
          return;
        }
        await this.refresh("caught_up");
        await this.sleep(20_000); // idle until the recorder pokes us with a new chunk
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.failures++;
        this.status.lastError = msg;
        const offline = !navigator.onLine || err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
        if (err instanceof HttpError && (err.status === 403 || err.status === 413)) {
          // not retryable: wrong account or the recording exceeds limits
          await this.refresh("error");
          this.onEvent("upload-error", msg);
          return;
        }
        await this.refresh(offline ? "offline" : "retrying");
        if (this.failures === 1) this.onEvent(offline ? "offline" : "upload-retrying", msg);
        await this.sleep(Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5)));
      }
    }
  }

  private succeeded() {
    if (this.failures) this.onEvent("upload-recovered", `after ${this.failures} failed attempts`);
    this.failures = 0;
    this.status.lastError = undefined;
    this.status.lastSuccessAt = Date.now();
  }
}
