export const STATUS_BADGE = {
  recording: { label: "Recording / uploading", tone: "blue" },
  uploading: { label: "Uploading", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  ready: { label: "Draft ready for review", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
} as const;
