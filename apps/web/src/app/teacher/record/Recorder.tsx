"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DOCUMENT_ACCEPT, MAX_RECORDING_MINUTES } from "@obs/shared";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { WORKER_URL } from "@/lib/supabase/env";
import { getRecording, putChunk, saveRecording, type LocalRecording } from "@/lib/recording/store";
import { RecordingUploader, type UploadStatus } from "@/lib/recording/uploader";
import { finishPlannerUpload, startPlannerUpload } from "./actions";

const MIME_CANDIDATES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
const TIMESLICE_MS = 10_000;
const WARN_BEFORE_LIMIT_MIN = 5;

type Phase = "setup" | "preview" | "recording" | "finishing" | "done";

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtMB = (b: number) => `${(b / 1e6).toFixed(b > 1e8 ? 0 : 1)} MB`;

export default function Recorder({ classId, className }: { classId: string; className: string }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [planner, setPlanner] = useState<File | null>(null);
  const [plannerState, setPlannerState] = useState<"none" | "waiting" | "uploading" | "done" | "error">("none");
  const [duplicate, setDuplicate] = useState<{ minutesAgo: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [interrupted, setInterrupted] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const localRef = useRef<LocalRecording | null>(null);
  const uploaderRef = useRef<RecordingUploader | null>(null);
  const seqRef = useRef(0);
  const persistChain = useRef<Promise<void>>(Promise.resolve());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const userStopped = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- duplicate check before recording (skipped if offline) ------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const res = await fetch(`${WORKER_URL}/recordings/duplicate-check?classId=${classId}`, { headers: { authorization: `Bearer ${data.session?.access_token}` } });
        if (!res.ok || cancelled) return;
        const { duplicate: d } = await res.json();
        if (d) setDuplicate({ minutesAgo: Math.max(1, Math.round((Date.now() - new Date(d.recordedAt).getTime()) / 60_000)) });
      } catch {
        // offline: the server flags a possible duplicate later instead
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  // ---- connectivity + lifecycle -------------------------------------------------------------------
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onVis = () => {
      if (document.visibilityState === "visible" && recRef.current?.state === "recording") {
        void requestWakeLock();
        const track = streamRef.current?.getVideoTracks()[0];
        if (track?.readyState === "ended" || track?.muted) setInterrupted("The camera was interrupted while you were away from this screen. Part of the lesson may be missing.");
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (recRef.current?.state === "recording" || (uploaderRef.current && uploaderRef.current.status.state !== "done")) e.preventDefault();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const iv = setInterval(() => setElapsed((Date.now() - (localRef.current?.startedAt ?? Date.now())) / 1000), 500);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(
    () => () => {
      // leaving the page: stop the camera; the uploader keeps going via the teacher home page
      streamRef.current?.getTracks().forEach((t) => t.stop());
      uploaderRef.current?.dispose();
    },
    [],
  );

  // ---- lesson planner: attached once the recording exists on the server -----------------------------
  const uploadPlanner = useCallback(async () => {
    const local = localRef.current;
    if (!planner || !local || plannerState === "uploading" || plannerState === "done") return;
    setPlannerState("uploading");
    const start = await startPlannerUpload({ recordingId: local.id, fileName: planner.name, size: planner.size, mimeType: planner.type });
    if ("error" in start && start.error) {
      setPlannerState("error");
      return;
    }
    const { path, token, documentId } = start as { path: string; token: string; documentId: string };
    const { error } = await createClient().storage.from("documents").uploadToSignedUrl(path, token, planner, { contentType: planner.type || undefined });
    if (error) {
      setPlannerState("error");
      return;
    }
    await finishPlannerUpload(documentId);
    await saveRecording({ ...(await getRecording(local.id))!, plannerUploaded: true });
    setPlannerState("done");
  }, [planner, plannerState]);

  useEffect(() => {
    if (upload?.serverCreated && planner && (plannerState === "waiting" || plannerState === "error")) void uploadPlanner();
  }, [upload?.serverCreated, planner, plannerState, uploadPlanner]);

  // ---- camera -------------------------------------------------------------------------------------
  async function requestWakeLock() {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      // not supported (older iOS in home-screen mode): the checklist tells teachers to disable auto-lock
    }
  }

  async function openCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, height: { ideal: 720 }, width: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
        // voice processing off: noise suppression can swallow quieter student voices
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      setPhase("preview");
    } catch (err) {
      setCameraError(err instanceof Error && err.name === "NotAllowedError" ? "Camera or microphone permission was denied. Allow access in your browser settings and try again." : `Couldn't open the camera: ${err}`);
    }
  }

  async function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    await navigator.storage?.persist?.().catch(() => false);
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000 });
    } catch (err) {
      setCameraError(`This browser can't record video: ${err}`);
      return;
    }
    const local: LocalRecording = { id: crypto.randomUUID(), classId, className, mimeType: rec.mimeType || mimeType, timesliceMs: TIMESLICE_MS, startedAt: Date.now() };
    localRef.current = local;
    await saveRecording(local);
    seqRef.current = 0;
    userStopped.current = false;
    if (planner) setPlannerState("waiting");

    rec.ondataavailable = (ev) => {
      if (!ev.data?.size) return;
      const seq = ++seqRef.current;
      const capturedAt = Date.now();
      // persist strictly in order; the uploader only ever reads from IndexedDB
      persistChain.current = persistChain.current.then(async () => {
        const data = await ev.data.arrayBuffer();
        await putChunk({ recordingId: local.id, seq, data, bytes: data.byteLength, capturedAt, uploaded: 0 });
        uploaderRef.current?.poke();
      });
    };
    rec.onstop = async () => {
      if (limitTimer.current) clearTimeout(limitTimer.current);
      if (!userStopped.current) setInterrupted("Recording stopped unexpectedly (the phone may have paused the camera). What was recorded is saved and will be uploaded.");
      await persistChain.current;
      await saveRecording({ ...(await getRecording(local.id))!, stoppedAt: Date.now(), totalChunks: seqRef.current });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      await wakeLockRef.current?.release().catch(() => undefined);
      uploaderRef.current?.poke();
      setPhase("finishing");
    };

    uploaderRef.current = new RecordingUploader(local.id, (s) => {
      setUpload(s);
      if (s.state === "done") setPhase("done");
    }).start();

    rec.start(TIMESLICE_MS);
    recRef.current = rec;
    setPhase("recording");
    void requestWakeLock();
    // guardrail: hard stop at the maximum lesson length
    limitTimer.current = setTimeout(() => stopRecording(), MAX_RECORDING_MINUTES * 60_000);
  }

  function stopRecording() {
    userStopped.current = true;
    setConfirmStop(false);
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }

  // ---- UI -----------------------------------------------------------------------------------------
  const minutesLeft = MAX_RECORDING_MINUTES - elapsed / 60;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">Recording lesson for</p>
          <h1 className="text-xl font-semibold">{className}</h1>
        </div>
        {phase === "setup" && (
          <Link href="/teacher" className="text-sm text-neutral-500 hover:underline">
            Cancel
          </Link>
        )}
      </div>

      {phase === "setup" && (
        <>
          {duplicate && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">You started a recording for this class {duplicate.minutesAgo} minute{duplicate.minutesAgo === 1 ? "" : "s"} ago.</p>
              <p>If that was a mistake, you don&apos;t need to record again. If you continue, the new recording will be marked as a possible duplicate for your administrator.</p>
            </div>
          )}
          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="mb-3 font-semibold">Before you start</h2>
            <ul className="space-y-2 text-sm">
              <Check>Phone on the tripod, turned sideways (landscape), facing you, with the board in view.</Check>
              <Check>Phone plugged in to a charger.</Check>
              <Check>Do Not Disturb on, and no alarms or timers set for the lesson. On iPhone, an alarm or timer pauses the camera and microphone.</Check>
              <Check strong>
                Keep Wi-Fi or mobile data <u>on</u>. Do <u>not</u> use Airplane Mode. The lesson uploads while you teach, so it&apos;s ready soon after class. If the
                connection drops, the video is saved on this phone and uploads automatically when it returns.
              </Check>
              <Check>Keep this screen open until the upload finishes. Don&apos;t lock the phone or switch apps.</Check>
            </ul>
          </section>
          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <h2 className="font-semibold">Today&apos;s lesson plan (recommended)</h2>
            <p className="mb-3 text-sm text-neutral-500">Attach it so the lesson can be compared with what you planned.</p>
            <input type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => setPlanner(e.target.files?.[0] ?? null)} className="text-sm" />
          </section>
          {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
          <Button onClick={openCamera} className="w-full py-3 text-base">
            Open camera
          </Button>
        </>
      )}

      <div className={`relative overflow-hidden rounded-xl bg-black ${phase === "preview" || phase === "recording" ? "" : "hidden"}`}>
        <video ref={previewRef} playsInline muted autoPlay className="aspect-video w-full object-contain" />
        {phase === "recording" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5 font-mono text-lg text-white">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" /> {fmtClock(elapsed)}
          </div>
        )}
      </div>

      {phase === "preview" && (
        <div className="flex gap-3">
          <Button onClick={startRecording} className="flex-1 bg-red-600 py-3 text-base hover:bg-red-700">
            Start recording
          </Button>
        </div>
      )}

      {(phase === "recording" || phase === "finishing" || phase === "done") && <UploadPanel upload={upload} online={online} phase={phase} />}

      {interrupted && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{interrupted}</p>}

      {phase === "recording" && (
        <>
          {minutesLeft < WARN_BEFORE_LIMIT_MIN && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Recording will stop automatically in {Math.max(0, Math.ceil(minutesLeft))} min (maximum {MAX_RECORDING_MINUTES} minutes).</p>
          )}
          {!confirmStop ? (
            <Button onClick={() => setConfirmStop(true)} variant="secondary" className="w-full py-3 text-base">
              Stop recording
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button onClick={stopRecording} className="flex-1 py-3 text-base">
                Yes, the lesson is over
              </Button>
              <Button onClick={() => setConfirmStop(false)} variant="secondary" className="flex-1 py-3 text-base">
                Keep recording
              </Button>
            </div>
          )}
        </>
      )}

      {planner && phase !== "setup" && phase !== "preview" && (
        <p className="text-sm text-neutral-500">
          Lesson plan:{" "}
          {plannerState === "done" ? "attached ✓" : plannerState === "error" ? "couldn't upload yet, will retry" : plannerState === "uploading" ? "uploading…" : "waiting for connection…"}
        </p>
      )}

      {phase === "done" && (
        <div className="space-y-3 rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <p className="font-medium">Lesson uploaded.</p>
          <p>
            It&apos;s now being transcribed and a draft observation report is being prepared for your administrator to review. You&apos;ll see the report in your
            history once your administrator has finalized it.
          </p>
          <Link href="/teacher" className="inline-block font-medium underline">
            Back to my classes
          </Link>
        </div>
      )}
    </div>
  );
}

function Check({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li className={`flex gap-2 ${strong ? "rounded-lg bg-blue-50 p-2 text-blue-950 dark:bg-blue-950 dark:text-blue-100" : ""}`}>
      <span aria-hidden className="mt-0.5 text-blue-800 dark:text-blue-300">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Always-visible upload state. Live upload replaces the old Airplane Mode habit, so this must be obvious. */
function UploadPanel({ upload, online, phase }: { upload: UploadStatus | null; online: boolean; phase: Phase }) {
  const pending = upload?.pendingChunks ?? 0;
  const offline = !online || upload?.state === "offline";
  const behindSec = Math.round((pending * TIMESLICE_MS) / 1000);

  if (upload?.state === "error") {
    return (
      <Banner tone="red" title="Upload stopped">
        {upload.lastError}. The recording is saved on this phone. Please tell your administrator.
      </Banner>
    );
  }
  if (offline) {
    return (
      <Banner tone="red" title={phase === "recording" ? "No connection. Still recording." : "No connection"}>
        The video is being saved on this phone ({fmtMB(upload?.pendingBytes ?? 0)} waiting). It will upload automatically when the connection returns.
        {phase !== "recording" && " Keep this screen open, or open the app again later to finish."}
      </Banner>
    );
  }
  if (phase === "done" || upload?.state === "done") {
    return (
      <Banner tone="green" title="Upload complete">
        All {upload?.totalChunks ?? ""} parts received.
      </Banner>
    );
  }
  if (phase === "finishing") {
    const total = upload?.totalChunks || 1;
    const pct = Math.round(((upload?.uploadedChunks ?? 0) / total) * 100);
    return (
      <Banner tone="blue" title="Finishing upload… keep this screen open">
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
          <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1">
          {upload?.uploadedChunks ?? 0} of {total} parts uploaded
        </p>
      </Banner>
    );
  }
  if (upload?.state === "retrying") {
    return (
      <Banner tone="amber" title="Connection is slow. Retrying">
        {pending} part{pending === 1 ? "" : "s"} waiting to upload. The video is safe on this phone.
      </Banner>
    );
  }
  return pending > 1 ? (
    <Banner tone="amber" title={`Uploading… about ${behindSec}s behind`}>
      The connection is a little slow; the video is safe on this phone and will catch up.
    </Banner>
  ) : (
    <Banner tone="green" title="Uploading live. Up to date">
      Each part of the lesson is sent as you teach.
    </Banner>
  );
}

function Banner({ tone, title, children }: { tone: "green" | "amber" | "red" | "blue"; title: string; children: React.ReactNode }) {
  const tones = {
    green: "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
    amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    red: "border-red-400 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    blue: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  };
  return (
    <div role="status" aria-live="polite" className={`rounded-xl border p-4 text-sm ${tones[tone]}`}>
      <p className="text-base font-semibold">{title}</p>
      <div>{children}</div>
    </div>
  );
}
