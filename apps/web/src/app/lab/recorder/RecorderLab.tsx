"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  assemble,
  chunkStats,
  deleteSession,
  getSession,
  listSessions,
  putChunk,
  putSession,
  type LabEvent,
  type LabSessionRow,
} from "@/lib/lab/store";
import { ChunkUploader, type WorkerTarget } from "@/lib/lab/uploader";

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

type Phase = "idle" | "preview" | "recording" | "stopped";

interface Settings {
  mimeType: string;
  timesliceSec: number;
  videoKbps: number;
  height: number;
  facing: "environment" | "user";
  voiceProcessing: boolean;
  maxMinutes: number;
}

interface ServerView {
  analysis?: {
    status: string;
    error?: string;
    normalizeMs?: number;
    normalizeRealtimeFactor?: number;
    decodedAudioSec?: number;
    sourceProbe?: { formatName?: string; durationSec?: number; video?: { codec: string; width: number; height: number; rotation?: number }; audio?: { codec: string } };
    normalizedProbe?: { durationSec?: number; sizeBytes?: number };
  };
  audioSlices?: { fromSec: number; durationSec?: number; ok: boolean; error?: string }[];
  missingChunks?: number[];
  appendedBytes?: number;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function readTarget(): WorkerTarget {
  const q = new URLSearchParams(location.search);
  const ls = (k: string) => {
    try {
      return localStorage.getItem(k) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const worker = q.get("worker") ?? ls("lab.worker");
  const token = q.get("token") ?? ls("lab.token");
  if (q.get("worker")) save("lab.worker", q.get("worker")!);
  if (q.get("token")) save("lab.token", q.get("token")!);
  // Talk to the worker directly: the same-origin /worker proxy is capped at 10 MB per request by Next,
  // fine for chunks but not for whole-file uploads. It's only the last-resort default for local dev.
  const base = worker ?? process.env.NEXT_PUBLIC_WORKER_URL ?? "/worker";
  return { baseUrl: `${base.replace(/\/$/, "")}/lab`, token: token ?? undefined };
}

function environment() {
  const nav = navigator as Navigator & { standalone?: boolean; deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
    standalone: nav.standalone === true || matchMedia("(display-mode: standalone)").matches,
    mediaRecorder: typeof MediaRecorder !== "undefined",
    getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    wakeLock: "wakeLock" in navigator,
    secureContext: isSecureContext,
    deviceMemoryGB: nav.deviceMemory,
    supportedMimeTypes: typeof MediaRecorder !== "undefined" ? MIME_CANDIDATES.filter((m) => MediaRecorder.isTypeSupported(m)) : [],
  };
}

export default function RecorderLab() {
  const [env] = useState(environment);
  const [target] = useState<WorkerTarget>(readTarget);
  const [settings, setSettings] = useState<Settings>({
    mimeType: env.supportedMimeTypes[0] ?? "",
    timesliceSec: 10,
    videoKbps: 1500,
    height: 720,
    facing: "environment",
    voiceProcessing: false,
    maxMinutes: 60,
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState({ count: 0, bytes: 0, uploaded: 0 });
  const [uploadErr, setUploadErr] = useState<string | undefined>();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [trackSettings, setTrackSettings] = useState<Record<string, unknown>>({});
  const [playback, setPlayback] = useState<{ url: string; size: number; durationSec?: number; ext: string } | null>(null);
  const [server, setServer] = useState<ServerView | null>(null);
  const [sessions, setSessions] = useState<(LabSessionRow & { count: number; bytes: number; uploaded: number })[]>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [copied, setCopied] = useState(false);
  const [fileUpload, setFileUpload] = useState<{ id: string; name: string; size: number; type: string; pct: number; ms?: number; error?: string } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<LabSessionRow | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const seqRef = useRef(0);
  const persistChain = useRef<Promise<void>>(Promise.resolve());
  const startedAt = useRef(0);
  const lastChunkAt = useRef(0);
  const lastTick = useRef(0);
  const userStopped = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const log = useCallback((type: string, detail?: string) => {
    const now = Date.now();
    const e: LabEvent = { t: startedAt.current ? now - startedAt.current : 0, at: now, type, detail };
    setEvents((prev) => [...prev, e]);
    const s = sessionRef.current;
    if (s) {
      s.events.push(e);
      void putSession(s);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    const s = sessionRef.current;
    if (s) setStats(await chunkStats(s.id));
    setUploadErr(uploaderRef.current?.status.lastError);
  }, []);

  const refreshSessions = useCallback(async () => {
    const all = await listSessions();
    setSessions(await Promise.all(all.map(async (s) => ({ ...s, ...(await chunkStats(s.id)) }))));
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
    setStorage({ usage: est?.usage, quota: est?.quota, persisted });
  }, []);

  // ---- mount: environment probe + lifecycle listeners -------------------------------------------
  useEffect(() => {
    // async IndexedDB read; state is only set after the await resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSessions();

    const onVis = () => {
      log(`visibility-${document.visibilityState}`);
      if (document.visibilityState === "visible" && recRef.current?.state === "recording") void requestWakeLock();
    };
    const onOnline = () => {
      setOnline(true);
      log("online");
    };
    const onOffline = () => {
      setOnline(false);
      log("offline");
    };
    const onPageHide = (ev: PageTransitionEvent) => log("pagehide", ev.persisted ? "bfcache" : undefined);
    const onPageShow = (ev: PageTransitionEvent) => log("pageshow", ev.persisted ? "bfcache" : undefined);
    const onFreeze = () => log("freeze");
    const onResume = () => log("resume");
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (recRef.current?.state === "recording") ev.preventDefault();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- recording clock + freeze detection -------------------------------------------------------
  useEffect(() => {
    if (phase !== "recording") return;
    lastTick.current = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      if (now - lastTick.current > 5000) log("timer-gap", `${Math.round((now - lastTick.current) / 1000)}s without JS ticks (page frozen?)`);
      const sinceChunk = now - lastChunkAt.current;
      if (sinceChunk > settings.timesliceSec * 1000 * 2.5 && lastChunkAt.current) {
        log("chunk-stall", `${Math.round(sinceChunk / 1000)}s since last chunk`);
        lastChunkAt.current = now; // don't spam
      }
      lastTick.current = now;
      setElapsed((now - startedAt.current) / 1000);
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, settings.timesliceSec, log]);

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return log("wakelock-unsupported");
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      log("wakelock-acquired");
      wakeLockRef.current.addEventListener("release", () => log("wakelock-released"));
    } catch (err) {
      log("wakelock-failed", String(err));
    }
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: settings.facing },
          height: { ideal: settings.height },
          width: { ideal: Math.round((settings.height * 16) / 9) },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: settings.voiceProcessing,
          noiseSuppression: settings.voiceProcessing,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      const ts: Record<string, unknown> = {};
      for (const t of stream.getTracks()) {
        ts[t.kind] = t.getSettings();
        t.addEventListener("ended", () => log(`track-ended`, t.kind));
        t.addEventListener("mute", () => log(`track-muted`, t.kind));
        t.addEventListener("unmute", () => log(`track-unmuted`, t.kind));
      }
      setTrackSettings(ts);
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      setPhase("preview");
    } catch (err) {
      alert(`Camera/mic failed: ${err}`);
    }
  }

  async function startRecording() {
    const stream = streamRef.current;
    if (!stream || !target) return;
    try {
      await navigator.storage?.persist?.();
    } catch {}
    const id = newId();
    const opts: MediaRecorderOptions = { videoBitsPerSecond: settings.videoKbps * 1000, audioBitsPerSecond: 96_000 };
    if (settings.mimeType) opts.mimeType = settings.mimeType;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, opts);
    } catch (err) {
      alert(`MediaRecorder failed: ${err}`);
      return;
    }
    startedAt.current = Date.now();
    lastChunkAt.current = Date.now();
    seqRef.current = 0;
    userStopped.current = false;
    persistChain.current = Promise.resolve();
    const session: LabSessionRow = {
      id,
      createdAt: startedAt.current,
      mimeType: rec.mimeType || settings.mimeType,
      timesliceMs: settings.timesliceSec * 1000,
      events: [],
    };
    sessionRef.current = session;
    await putSession(session);
    setEvents([]);
    setServer(null);
    setPlayback(null);
    setElapsed(0);
    log("recorder-created", `mimeType=${rec.mimeType} requested=${settings.mimeType || "(default)"}`);

    rec.ondataavailable = (ev) => {
      const now = Date.now();
      const gap = now - lastChunkAt.current;
      lastChunkAt.current = now;
      if (!ev.data || ev.data.size === 0) {
        log("empty-chunk", `gap ${gap}ms`);
        return;
      }
      const seq = ++seqRef.current;
      const size = ev.data.size;
      if (gap > settings.timesliceSec * 1000 * 1.8) log("late-chunk", `seq ${seq} after ${Math.round(gap / 1000)}s`);
      // persist strictly in order; the uploader only ever reads from IndexedDB
      persistChain.current = persistChain.current.then(async () => {
        try {
          const data = await ev.data.arrayBuffer();
          await putChunk({ sessionId: id, seq, data, bytes: size, capturedAt: now, uploaded: 0 });
          uploaderRef.current?.poke();
          void refreshStats();
        } catch (err) {
          log("persist-failed", `seq ${seq}: ${err}`);
        }
      });
    };
    rec.onerror = (ev) => log("recorder-error", String((ev as unknown as { error?: unknown }).error ?? ev.type));
    rec.onpause = () => log("recorder-paused");
    rec.onresume = () => log("recorder-resumed");
    rec.onstop = async () => {
      if (!userStopped.current) log("recorder-stopped-unexpectedly");
      if (maxDurationTimer.current) clearTimeout(maxDurationTimer.current);
      await persistChain.current;
      const s = (await getSession(id))!;
      s.stoppedAt = Date.now();
      s.totalChunks = seqRef.current;
      s.events = sessionRef.current?.events ?? s.events;
      sessionRef.current = s;
      await putSession(s);
      log("recorder-stopped", `${seqRef.current} chunks, wall ${Math.round((s.stoppedAt - s.createdAt) / 1000)}s`);
      await wakeLockRef.current?.release().catch(() => undefined);
      uploaderRef.current?.poke();
      setPhase("stopped");
      await refreshStats();
      await verifyLocal(s);
      void refreshSessions();
    };

    uploaderRef.current?.dispose();
    const up = new ChunkUploader(id, target, { mimeType: session.mimeType, timesliceMs: session.timesliceMs, startedAt: session.createdAt }, log, () => void refreshStats());
    uploaderRef.current = up;
    up.start();

    rec.start(settings.timesliceSec * 1000);
    recRef.current = rec;
    log("recorder-started");
    setPhase("recording");
    void requestWakeLock();
    maxDurationTimer.current = setTimeout(() => {
      log("max-duration-reached", `${settings.maxMinutes} min`);
      stopRecording();
    }, settings.maxMinutes * 60_000);
  }

  function stopRecording() {
    userStopped.current = true;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPhase("idle");
  }

  /** Reassemble the chunks from IndexedDB and confirm the browser can play them back. */
  async function verifyLocal(s: LabSessionRow) {
    const blob = await assemble(s.id, s.mimeType);
    const url = URL.createObjectURL(blob);
    const ext = s.mimeType.includes("mp4") ? "mp4" : s.mimeType.includes("webm") ? "webm" : "bin";
    setPlayback({ url, size: blob.size, ext });
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    const duration = await new Promise<number | undefined>((resolve) => {
      const done = (d?: number) => resolve(d);
      const to = setTimeout(() => done(undefined), 15_000);
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration)) {
          clearTimeout(to);
          return done(v.duration);
        }
        // MediaRecorder WebM has no duration header; seeking far forces the browser to compute it
        v.ontimeupdate = () => {
          v.ontimeupdate = null;
          clearTimeout(to);
          done(Number.isFinite(v.duration) ? v.duration : undefined);
        };
        v.currentTime = 1e101;
      };
      v.onerror = () => {
        clearTimeout(to);
        log("local-playback-error", v.error?.message ?? String(v.error?.code));
        done(undefined);
      };
    });
    setPlayback({ url, size: blob.size, ext, durationSec: duration });
    log("local-verify", duration ? `playable, ${duration.toFixed(1)}s` : "duration unknown");
  }

  // ---- poll server analysis once finalized ------------------------------------------------------
  const pollServer = useCallback(
    async (id: string) => {
      if (!target) return;
      for (let i = 0; i < 400; i++) {
        try {
          const r = await fetch(`${target.baseUrl}/sessions/${id}`, { headers: target.token ? { "x-lab-token": target.token } : {} });
          if (r.ok) {
            const m = (await r.json()) as ServerView;
            setServer(m);
            if (m.analysis && m.analysis.status !== "running") return m;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 3000));
      }
    },
    [target],
  );

  useEffect(() => {
    if (phase !== "stopped" || !sessionRef.current) return;
    const id = sessionRef.current.id;
    let cancelled = false;
    (async () => {
      while (!cancelled && !uploaderRef.current?.status.finalized) await new Promise((r) => setTimeout(r, 1500));
      if (!cancelled) await pollServer(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, pollServer]);

  // ---- diagnostics ------------------------------------------------------------------------------
  function diagnostics() {
    const s = sessionRef.current;
    const wall = s?.stoppedAt ? (s.stoppedAt - s.createdAt) / 1000 : elapsed;
    const eventsOf = (type: string) => events.filter((e) => e.type === type).length;
    return {
      version: 1,
      sessionId: s?.id,
      env,
      settings,
      trackSettings,
      recorderMimeType: s?.mimeType,
      wallClockSec: Math.round(wall),
      chunks: stats.count,
      bytes: stats.bytes,
      avgKbps: wall ? Math.round((stats.bytes * 8) / wall / 1000) : undefined,
      uploaded: stats.uploaded,
      localPlaybackSec: playback?.durationSec,
      localVsWallDiffSec: playback?.durationSec ? Number((playback.durationSec - wall).toFixed(1)) : undefined,
      counts: {
        visibilityHidden: eventsOf("visibility-hidden"),
        timerGaps: eventsOf("timer-gap"),
        chunkStalls: eventsOf("chunk-stall"),
        emptyChunks: eventsOf("empty-chunk"),
        uploadErrors: eventsOf("upload-error"),
        trackMuted: eventsOf("track-muted"),
        trackEnded: eventsOf("track-ended"),
        unexpectedStop: eventsOf("recorder-stopped-unexpectedly"),
        wakelockReleased: eventsOf("wakelock-released"),
      },
      server: server
        ? {
            status: server.analysis?.status,
            error: server.analysis?.error,
            container: server.analysis?.sourceProbe?.formatName,
            video: server.analysis?.sourceProbe?.video,
            audio: server.analysis?.sourceProbe?.audio?.codec,
            decodedAudioSec: server.analysis?.decodedAudioSec,
            normalizedSec: server.analysis?.normalizedProbe?.durationSec,
            normalizeRealtimeFactor: server.analysis?.normalizeRealtimeFactor,
            rollingAudioSlices: server.audioSlices?.map((a) => ({ from: Math.round(a.fromSec), dur: a.durationSec && Math.round(a.durationSec), ok: a.ok })),
          }
        : null,
      storage,
      events,
    };
  }

  async function copyDiagnostics() {
    const d = diagnostics();
    const text = JSON.stringify(d, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy diagnostics:", text);
    }
    if (target && d.sessionId) {
      void fetch(`${target.baseUrl}/sessions/${d.sessionId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(target.token ? { "x-lab-token": target.token } : {}) },
        body: text,
      }).catch(() => undefined);
    }
  }

  // ---- fallback path test: native camera file upload --------------------------------------------
  function uploadFile(file: File) {
    if (!target) return;
    const id = newId();
    const started = Date.now();
    setFileUpload({ id, name: file.name, size: file.size, type: file.type, pct: 0 });
    setServer(null);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${target.baseUrl}/uploads/${id}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-file-name", file.name);
    if (target.token) xhr.setRequestHeader("x-lab-token", target.token);
    xhr.upload.onprogress = (e) => e.lengthComputable && setFileUpload((f) => f && { ...f, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setFileUpload((f) => f && { ...f, pct: 100, ms: Date.now() - started });
        void pollServer(id);
      } else setFileUpload((f) => f && { ...f, error: `${xhr.status} ${xhr.responseText.slice(0, 200)}` });
    };
    xhr.onerror = () => setFileUpload((f) => f && { ...f, error: "network error" });
    xhr.send(file);
  }

  async function resumeUpload(s: LabSessionRow) {
    if (!target) return;
    // an interrupted session (tab killed mid-recording) never got a total; finalize with what survived
    if (s.totalChunks === undefined) {
      s = { ...s, totalChunks: (await chunkStats(s.id)).count };
      await putSession(s);
    }
    sessionRef.current = s;
    uploaderRef.current?.dispose();
    const up = new ChunkUploader(s.id, target, { mimeType: s.mimeType, timesliceMs: s.timesliceMs, startedAt: s.createdAt }, log, () => void refreshStats());
    uploaderRef.current = up;
    up.start();
    setEvents(s.events);
    setPhase("stopped");
    await refreshStats();
  }

  // ---- UI ---------------------------------------------------------------------------------------
  const recording = phase === "recording";
  const pending = stats.count - stats.uploaded;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-24 text-sm">
      <header>
        <h1 className="text-xl font-semibold">Recording lab</h1>
        <p className="text-neutral-500">Validates in-browser recording on this device. Keep the screen on while recording.</p>
      </header>

      {env && (
        <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="mb-1 font-medium">This device</h2>
          <ul className="space-y-0.5 text-xs">
            <li>Installed app (standalone): {env.standalone ? "yes" : "no — open in browser tab"}</li>
            <li>MediaRecorder: {env.mediaRecorder ? "yes" : "NO"} · Wake Lock: {env.wakeLock ? "yes" : "no"} · HTTPS: {env.secureContext ? "yes" : "NO"}</li>
            <li>Formats: {env.supportedMimeTypes.join(", ") || "none"}</li>
            <li className="break-all text-neutral-500">{env.userAgent}</li>
          </ul>
        </section>
      )}

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={previewRef} playsInline muted autoPlay className="aspect-video w-full object-contain" />
        {recording && (
          <div className="absolute left-2 top-2 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> {fmtTime(elapsed)}
          </div>
        )}
      </div>

      {phase === "idle" && (
        <section className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="font-medium">Settings</h2>
          <label className="block">
            Format{" "}
            <select className="rounded border px-1 dark:bg-neutral-900" value={settings.mimeType} onChange={(e) => setSettings({ ...settings, mimeType: e.target.value })}>
              {env?.supportedMimeTypes.map((m) => <option key={m}>{m}</option>)}
              <option value="">(browser default)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              Chunk (s){" "}
              <input type="number" className="w-16 rounded border px-1 dark:bg-neutral-900" value={settings.timesliceSec} min={1} max={60} onChange={(e) => setSettings({ ...settings, timesliceSec: Number(e.target.value) })} />
            </label>
            <label>
              Video kbps{" "}
              <input type="number" className="w-20 rounded border px-1 dark:bg-neutral-900" value={settings.videoKbps} step={250} onChange={(e) => setSettings({ ...settings, videoKbps: Number(e.target.value) })} />
            </label>
            <label>
              Height{" "}
              <select className="rounded border px-1 dark:bg-neutral-900" value={settings.height} onChange={(e) => setSettings({ ...settings, height: Number(e.target.value) })}>
                <option value={480}>480p</option>
                <option value={720}>720p</option>
                <option value={1080}>1080p</option>
              </select>
            </label>
            <label>
              Camera{" "}
              <select className="rounded border px-1 dark:bg-neutral-900" value={settings.facing} onChange={(e) => setSettings({ ...settings, facing: e.target.value as Settings["facing"] })}>
                <option value="environment">Back</option>
                <option value="user">Front</option>
              </select>
            </label>
            <label>
              Max minutes{" "}
              <input type="number" className="w-16 rounded border px-1 dark:bg-neutral-900" value={settings.maxMinutes} onChange={(e) => setSettings({ ...settings, maxMinutes: Number(e.target.value) })} />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={settings.voiceProcessing} onChange={(e) => setSettings({ ...settings, voiceProcessing: e.target.checked })} /> Voice processing
            </label>
          </div>
          <p className="text-xs text-neutral-500">Uploading to: {target?.baseUrl}</p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {phase === "idle" && <Btn onClick={openCamera}>Open camera</Btn>}
        {phase === "preview" && (
          <>
            <Btn onClick={startRecording} className="bg-red-600 text-white">Start recording</Btn>
            <Btn onClick={closeCamera}>Close camera</Btn>
          </>
        )}
        {recording && <Btn onClick={stopRecording} className="bg-neutral-900 text-white dark:bg-white dark:text-black">Stop</Btn>}
        {phase === "stopped" && <Btn onClick={() => { closeCamera(); void refreshSessions(); }}>New test</Btn>}
      </div>

      {(recording || phase === "stopped") && (
        <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="mb-1 font-medium">Status</h2>
          <ul className="space-y-0.5">
            <li>Chunks saved on phone: {stats.count} ({fmtBytes(stats.bytes)})</li>
            <li>
              Uploaded: {stats.uploaded}/{stats.count} {pending > 0 && <span className="text-amber-600">· {pending} queued</span>} {!online && <span className="text-red-600">· offline</span>}
            </li>
            {uploadErr && <li className="text-red-600">Last upload error: {uploadErr}</li>}
            {playback && (
              <li>
                Local playback: {playback.durationSec ? `${playback.durationSec.toFixed(1)}s ✓` : "unknown"} · {fmtBytes(playback.size)} ·{" "}
                <a className="underline" href={playback.url} download={`lab-${sessionRef.current?.id}.${playback.ext}`}>download</a>
              </li>
            )}
          </ul>
          {playback && <video src={playback.url} controls playsInline className="mt-2 w-full rounded" />}
        </section>
      )}

      {server && <ServerPanel server={server} />}

      {(phase === "stopped" || events.length > 0) && (
        <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-medium">Events ({events.length})</h2>
            <Btn onClick={copyDiagnostics}>{copied ? "Copied ✓" : "Copy diagnostics"}</Btn>
          </div>
          <ol className="max-h-64 space-y-0.5 overflow-auto font-mono text-xs">
            {events.map((e, i) => (
              <li key={i}>
                <span className="text-neutral-500">{fmtTime(e.t / 1000)}</span> {e.type} {e.detail && <span className="text-neutral-500">{e.detail}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {phase === "idle" && (
        <section className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="font-medium">Fallback test: upload a camera-app video</h2>
          <input type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
          {fileUpload && (
            <p>
              {fileUpload.name} · {fmtBytes(fileUpload.size)} · {fileUpload.type || "unknown type"} · {fileUpload.pct}%
              {fileUpload.ms && ` · ${Math.round(fileUpload.ms / 1000)}s`}
              {fileUpload.error && <span className="text-red-600"> · {fileUpload.error}</span>}
            </p>
          )}
        </section>
      )}

      {phase === "idle" && sessions.length > 0 && (
        <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <h2 className="mb-1 font-medium">Saved on this device</h2>
          <p className="mb-2 text-xs text-neutral-500">
            Storage: {storage.usage !== undefined ? fmtBytes(storage.usage) : "?"} of {storage.quota !== undefined ? fmtBytes(storage.quota) : "?"} · persistent: {String(storage.persisted ?? "?")}
          </p>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  {new Date(s.createdAt).toLocaleString()} · {s.count} chunks · {fmtBytes(s.bytes)} · up {s.uploaded}/{s.count}
                  {s.totalChunks === undefined && " · interrupted"}
                  {s.finalizedOnServer && " · on server ✓"}
                </span>
                {!s.finalizedOnServer && <Btn onClick={() => void resumeUpload(s)}>Resume upload</Btn>}
                <Btn onClick={async () => { await deleteSession(s.id); void refreshSessions(); }}>Delete</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function ServerPanel({ server }: { server: ServerView }) {
  const a = server.analysis;
  const slices = server.audioSlices ?? [];
  return (
    <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="mb-1 font-medium">Server check</h2>
      {!a && <p>Waiting for upload to finish…</p>}
      {a?.status === "running" && <p>Normalizing video on server…</p>}
      {a?.status === "failed" && <p className="text-red-600">Failed: {a.error}</p>}
      {a?.status === "done" && (
        <ul className="space-y-0.5">
          <li>
            Source: {a.sourceProbe?.formatName} · {a.sourceProbe?.video?.codec} {a.sourceProbe?.video?.width}×{a.sourceProbe?.video?.height}
            {a.sourceProbe?.video?.rotation ? ` (rot ${a.sourceProbe.video.rotation})` : ""} · {a.sourceProbe?.audio?.codec}
          </li>
          <li>Decoded audio: {a.decodedAudioSec?.toFixed(1)}s · Normalized: {a.normalizedProbe?.durationSec?.toFixed(1)}s ({a.normalizedProbe?.sizeBytes ? fmtBytes(a.normalizedProbe.sizeBytes) : "?"})</li>
          <li>Normalize took {((a.normalizeMs ?? 0) / 1000).toFixed(1)}s ({a.normalizeRealtimeFactor}× realtime)</li>
        </ul>
      )}
      {slices.length > 0 && (
        <p className="mt-1 text-xs">
          Rolling audio slices: {slices.map((s) => `${Math.round(s.fromSec)}s+${s.durationSec ? Math.round(s.durationSec) : "?"}${s.ok ? "" : "✗"}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

function Btn({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-md border border-neutral-300 px-3 py-2 font-medium active:opacity-70 dark:border-neutral-700 ${className}`} />;
}
