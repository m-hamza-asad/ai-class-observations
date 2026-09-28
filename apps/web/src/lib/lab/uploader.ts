/**
 * Background chunk uploader: drains IndexedDB in seq order, retries with backoff,
 * wakes immediately when the browser reports it is back online, and finalizes once
 * recording has stopped and every chunk is on the server.
 */
import { getSession, markUploaded, nextPending, putSession } from "./store";

export interface WorkerTarget {
  baseUrl: string; // e.g. "/worker/lab" or "https://worker.example.com/lab"
  token?: string;
}

export interface UploaderStatus {
  lastError?: string;
  consecutiveFailures: number;
  finalized: boolean;
}

type Log = (type: string, detail?: string) => void;

export class ChunkUploader {
  private wake: (() => void) | null = null;
  private stopped = false;
  private sessionCreated = false;
  status: UploaderStatus = { consecutiveFailures: 0, finalized: false };

  constructor(
    private sessionId: string,
    private target: WorkerTarget,
    private meta: { mimeType: string; timesliceMs: number; startedAt: number },
    private log: Log,
    private onChange: () => void,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return this.target.token ? { ...extra, "x-lab-token": this.target.token } : extra;
  }

  private async req(path: string, init: RequestInit, timeoutMs = 60_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.target.baseUrl}${path}`, { ...init, signal: ctrl.signal });
      if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  poke = () => this.wake?.();

  start() {
    window.addEventListener("online", this.poke);
    void this.loop();
  }

  dispose() {
    this.stopped = true;
    window.removeEventListener("online", this.poke);
    this.poke();
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

  private async loop() {
    while (!this.stopped) {
      try {
        if (!this.sessionCreated) {
          await this.req("/sessions", {
            method: "POST",
            headers: this.headers({ "content-type": "application/json" }),
            body: JSON.stringify({ id: this.sessionId, userAgent: navigator.userAgent, mimeType: this.meta.mimeType, timesliceMs: this.meta.timesliceMs }),
          });
          this.sessionCreated = true;
        }
        const chunk = await nextPending(this.sessionId);
        if (chunk) {
          await this.req(`/sessions/${this.sessionId}/chunks/${chunk.seq}`, {
            method: "PUT",
            headers: this.headers({ "content-type": "application/octet-stream", "x-chunk-t": String(chunk.capturedAt - this.meta.startedAt) }),
            body: chunk.data,
          });
          await markUploaded(this.sessionId, chunk.seq);
          this.succeeded();
          continue;
        }
        const s = await getSession(this.sessionId);
        if (s?.totalChunks && !s.finalizedOnServer) {
          await this.req(`/sessions/${this.sessionId}/finalize`, {
            method: "POST",
            headers: this.headers({ "content-type": "application/json" }),
            body: JSON.stringify({ totalChunks: s.totalChunks }),
          });
          await putSession({ ...s, finalizedOnServer: true });
          this.status.finalized = true;
          this.log("server-finalized");
          this.succeeded();
          return;
        }
        if (s?.finalizedOnServer) {
          this.status.finalized = true;
          this.onChange();
          return;
        }
        await this.sleep(15_000); // idle until the next chunk pokes us
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.status.consecutiveFailures++;
        if (this.status.consecutiveFailures === 1 || this.status.lastError !== msg) this.log("upload-error", msg);
        this.status.lastError = msg;
        this.onChange();
        const backoff = Math.min(30_000, 1000 * 2 ** Math.min(this.status.consecutiveFailures - 1, 5));
        await this.sleep(backoff);
      }
    }
  }

  private succeeded() {
    if (this.status.consecutiveFailures > 0) this.log("upload-recovered", `after ${this.status.consecutiveFailures} failures`);
    this.status.consecutiveFailures = 0;
    this.status.lastError = undefined;
    this.onChange();
  }
}
