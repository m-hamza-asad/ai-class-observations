"use client";

import { useEffect, useState } from "react";
import { chunkCounts, listRecordings, saveRecording } from "@/lib/recording/store";
import { RecordingUploader, type UploadStatus } from "@/lib/recording/uploader";

/**
 * Finishes uploads left on this phone (app closed mid-upload, or offline at the end of a lesson).
 * Rendered on the teacher home page; resumes automatically, no action needed from the teacher.
 */
export default function PendingUploads() {
  const [items, setItems] = useState<Record<string, { className: string; status: UploadStatus | null }>>({});

  useEffect(() => {
    let cancelled = false;
    const uploaders: RecordingUploader[] = [];
    (async () => {
      for (const rec of await listRecordings()) {
        if (rec.finished || cancelled) continue;
        const { count } = await chunkCounts(rec.id);
        if (!count) continue;
        // a recording with no total was cut off (page closed mid-lesson): finalize with what was saved
        if (rec.totalChunks === undefined) await saveRecording({ ...rec, totalChunks: count, stoppedAt: rec.stoppedAt ?? Date.now() });
        setItems((m) => ({ ...m, [rec.id]: { className: rec.className, status: null } }));
        uploaders.push(
          new RecordingUploader(rec.id, (s) => setItems((m) => ({ ...m, [rec.id]: { className: rec.className, status: s } }))).start(),
        );
      }
    })();
    return () => {
      cancelled = true;
      uploaders.forEach((u) => u.dispose());
    };
  }, []);

  const open = Object.entries(items).filter(([, v]) => v.status?.state !== "done");
  if (!open.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {open.map(([id, { className, status }]) => {
        const offline = status?.state === "offline";
        return (
          <div
            key={id}
            role="status"
            className={`rounded-xl border p-4 text-sm ${offline ? "border-red-400 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200" : "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"}`}
          >
            <p className="font-semibold">
              {offline ? "Waiting for connection" : "Finishing upload"}: {className}
            </p>
            <p>
              {status ? `${status.uploadedChunks} of ${status.totalChunks} parts uploaded.` : "Checking…"} Keep the app open until this finishes.
            </p>
          </div>
        );
      })}
    </div>
  );
}
