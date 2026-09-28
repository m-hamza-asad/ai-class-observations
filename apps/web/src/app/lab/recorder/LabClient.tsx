"use client";

import dynamic from "next/dynamic";

// Browser-only: the lab reads MediaRecorder, IndexedDB and navigator at first render.
const RecorderLab = dynamic(() => import("./RecorderLab"), { ssr: false, loading: () => <p className="p-4">Loading…</p> });

export default function LabClient() {
  return <RecorderLab />;
}
