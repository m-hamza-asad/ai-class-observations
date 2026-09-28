// Domain constants shared by web and worker.

export const DOCUMENT_TYPES = {
  kpis: "Teacher KPIs",
  tors: "Terms of reference",
  learning_outcomes: "Learning outcomes",
  planner: "Lesson planner",
  other: "Other",
} as const;
export type DocumentTypeKey = keyof typeof DOCUMENT_TYPES;

/** Class-level reference documents (context for the report narrative). Lesson planners are attached per recording. */
export const CLASS_DOCUMENT_TYPES: DocumentTypeKey[] = ["kpis", "tors", "learning_outcomes", "other"];

export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md";
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Guardrails for recordings (enforced in the recorder and again server-side). */
export const MAX_RECORDING_MINUTES = 60;
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
/** A second recording for the same teacher+class started within this window is flagged as a likely duplicate. */
export const DUPLICATE_WINDOW_MINUTES = 20;

/** Rolling transcription: an audio slice is cut from the growing recording every this many seconds. */
export const TRANSCRIPTION_SLICE_SECONDS = 60;

export * from "./framework.ts";
