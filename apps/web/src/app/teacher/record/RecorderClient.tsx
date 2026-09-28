"use client";

import dynamic from "next/dynamic";

// Browser-only: reads MediaRecorder, IndexedDB and navigator at first render.
const Recorder = dynamic(() => import("./Recorder"), { ssr: false, loading: () => <p className="p-4 text-sm text-neutral-500">Loading recorder…</p> });

export default function RecorderClient(props: { classId: string; className: string }) {
  return <Recorder {...props} />;
}
