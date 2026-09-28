/**
 * pg-boss job queue on the Supabase Postgres database (its own `pgboss` schema), so there's no
 * Redis to run. Retries use exponential backoff; processing_jobs mirrors state for the UI.
 */
import { PgBoss } from "pg-boss";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { db } from "./lib/supabase.js";
import { createJobRow } from "./jobs/tracking.js";
import { handleDocumentParse, type DocumentParseData } from "./jobs/documentParse.js";
import {
  handleAssembleTranscript,
  handleGenerateReport,
  handleNormalize,
  handleTranscribeSlice,
  type SliceJob,
  type StageJob,
} from "./jobs/pipeline.js";
import { QUEUES, send, setBoss } from "./queue/boss.js";

let boss: PgBoss | null = null;

export async function startQueue() {
  boss = new PgBoss({ connectionString: config.DATABASE_URL!, application_name: "observation-worker" });
  boss.on("error", (err: unknown) => logger.error({ stage: "queue", error: String(err) }, "pg-boss error"));
  await boss.start();
  setBoss(boss);

  for (const q of Object.values(QUEUES)) {
    await boss.createQueue(q.name, { retryLimit: q.retryLimit, retryDelay: q.retryDelay, retryBackoff: true });
  }

  const one = { includeMetadata: true, batchSize: 1 } as const;
  await boss.work<DocumentParseData>(QUEUES.documentParse.name, one, async ([job]) => {
    await handleDocumentParse(job.data, job.retryCount, QUEUES.documentParse.retryLimit);
  });
  // slices run a few at a time so a backlog after a connectivity drop clears quickly
  await boss.work<SliceJob>(QUEUES.transcribeSlice.name, { includeMetadata: true, batchSize: 1, localConcurrency: 4 }, async ([job]) => {
    await handleTranscribeSlice(job.data, job.retryCount, QUEUES.transcribeSlice.retryLimit);
  });
  await boss.work<StageJob>(QUEUES.normalize.name, one, async ([job]) => {
    await handleNormalize(job.data, job.retryCount, QUEUES.normalize.retryLimit);
  });
  await boss.work<{ recordingId: string }>(QUEUES.assembleTranscript.name, one, async ([job]) => {
    await handleAssembleTranscript(job.data, job.retryCount, QUEUES.assembleTranscript.retryLimit);
  });
  await boss.work<StageJob>(QUEUES.generateReport.name, { includeMetadata: true, batchSize: 1, localConcurrency: 2 }, async ([job]) => {
    await handleGenerateReport(job.data, job.retryCount, QUEUES.generateReport.retryLimit);
  });

  await reconcilePendingDocuments();
  logger.info({ stage: "queue" }, "queue started");
}

export async function stopQueue() {
  await boss?.stop({ graceful: true });
}

export async function enqueueDocumentParse(documentId: string, classId: string) {
  // skip if a parse for this document is already queued or running
  const { data: active } = await db()
    .from("processing_jobs")
    .select("id")
    .eq("document_id", documentId)
    .eq("stage", "document_parse")
    .in("status", ["pending", "processing"])
    .limit(1);
  if (active?.length) return active[0].id;

  const jobRowId = await createJobRow({ stage: "document_parse", documentId, classId }, QUEUES.documentParse.retryLimit + 1);
  await send("documentParse", { jobRowId, documentId } satisfies DocumentParseData);
  logger.info({ stage: "document_parse", documentId, classId, jobId: jobRowId }, "enqueued");
  return jobRowId;
}

/**
 * Safety net: a document whose "uploaded" call never reached the worker (network drop, worker
 * restart) would otherwise sit in 'pending' forever. On startup, enqueue anything left behind.
 */
async function reconcilePendingDocuments() {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: docs } = await db()
    .from("documents")
    .select("id, class_id")
    .eq("parse_status", "pending")
    .is("superseded_at", null)
    .lt("uploaded_at", cutoff);
  for (const d of docs ?? []) await enqueueDocumentParse(d.id, d.class_id);
  if (docs?.length) logger.info({ stage: "document_parse", count: docs.length }, "re-enqueued pending documents");
}
