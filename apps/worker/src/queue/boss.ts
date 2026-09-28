import { PgBoss } from "pg-boss";

/** Queue names and retry policy (retryLimit = retries after the first attempt; backoff is exponential). */
export const QUEUES = {
  documentParse: { name: "document-parse", retryLimit: 2, retryDelay: 10 },
  transcribeSlice: { name: "transcribe-slice", retryLimit: 3, retryDelay: 15 },
  normalize: { name: "normalize-recording", retryLimit: 2, retryDelay: 30 },
  assembleTranscript: { name: "assemble-transcript", retryLimit: 2, retryDelay: 10 },
  generateReport: { name: "generate-report", retryLimit: 2, retryDelay: 60 },
} as const;

export type QueueKey = keyof typeof QUEUES;

let boss: PgBoss | null = null;

export function setBoss(b: PgBoss) {
  boss = b;
}

export async function send(queue: QueueKey, data: object, options: { singletonKey?: string } = {}) {
  if (!boss) throw new Error("queue not started");
  return boss.send(QUEUES[queue].name, data, options);
}
