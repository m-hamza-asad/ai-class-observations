/**
 * Teacher recording API. Browsers call these directly (video can't go through Vercel), authenticated
 * with the teacher's Supabase session token. Recording ids are generated on the phone, so recording
 * can start offline and the server record is created on the first successful request.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";
import { DUPLICATE_WINDOW_MINUTES } from "@obs/shared";
import { authenticate } from "../lib/auth.js";
import { db } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { finishIngest, IngestError, ingestOwner, initIngest, receiveChunk } from "../recordings/ingest.js";
import { enqueueSlices, onRecordingFinished } from "../jobs/pipeline.js";

const uuid = z.string().uuid();

function teacherOnly(req: FastifyRequest) {
  if (req.profile?.role !== "teacher") throw new IngestError(403, "only teachers record lessons");
  return req.profile;
}

async function findDuplicate(teacherId: string, classId: string, startedAt: Date, excludeId?: string) {
  const since = new Date(startedAt.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString();
  let q = db().from("recordings").select("id, recorded_at, status").eq("teacher_id", teacherId).eq("class_id", classId).gte("recorded_at", since).order("recorded_at", { ascending: false }).limit(1);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return data?.[0] ?? null;
}

export async function recordingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof IngestError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? "invalid request" });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error({ stage: "upload", error: err instanceof Error ? err.message : String(err) }, "recording route failed");
    return reply.code(500).send({ error: "internal error" });
  });

  // Before starting: has this teacher already recorded this class very recently? (likely a double-recording)
  app.get<{ Querystring: { classId: string } }>("/duplicate-check", async (req) => {
    const teacher = teacherOnly(req);
    const classId = uuid.parse(req.query.classId);
    const dup = await findDuplicate(teacher.id, classId, new Date());
    return { duplicate: dup ? { id: dup.id, recordedAt: dup.recorded_at, status: dup.status, windowMinutes: DUPLICATE_WINDOW_MINUTES } : null };
  });

  // Create (idempotent: the phone retries this until it succeeds)
  app.post<{ Body: { id: string; classId: string; mimeType?: string; startedAt?: string } }>("/", async (req) => {
    const teacher = teacherOnly(req);
    const body = z.object({ id: uuid, classId: uuid, mimeType: z.string().max(100).optional(), startedAt: z.string().datetime().optional() }).parse(req.body);

    const { data: existing } = await db().from("recordings").select("id, teacher_id, status, possible_duplicate_of").eq("id", body.id).maybeSingle();
    if (existing) {
      if (existing.teacher_id !== teacher.id) throw new IngestError(403, "not your recording");
      await initIngest(body.id, teacher.id, body.mimeType);
      return existing;
    }

    const { data: cls } = await db().from("classes").select("id, campus_id, teacher_id").eq("id", body.classId).maybeSingle();
    if (!cls || cls.teacher_id !== teacher.id) throw new IngestError(403, "you are not the teacher of this class");

    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const today = startedAt.toISOString().slice(0, 10);
    const [dup, { data: term }] = await Promise.all([
      findDuplicate(teacher.id, cls.id, startedAt),
      db().from("academic_terms").select("id, ends_on").eq("campus_id", cls.campus_id).lte("starts_on", today).gte("ends_on", today).order("starts_on", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const { data: rec, error } = await db()
      .from("recordings")
      .insert({
        id: body.id,
        campus_id: cls.campus_id,
        class_id: cls.id,
        teacher_id: teacher.id,
        source: "in_app",
        status: "recording",
        mime_type: body.mimeType ?? null,
        recorded_at: startedAt.toISOString(),
        term_id: term?.id ?? null,
        // video is kept until the end of the term it was recorded in (admin-managed terms)
        semester_expiry_date: term?.ends_on ?? null,
        possible_duplicate_of: dup?.id ?? null,
      })
      .select("id, teacher_id, status, possible_duplicate_of")
      .single();
    if (error) throw error;
    await initIngest(rec.id, teacher.id, body.mimeType);
    await db().from("processing_jobs").insert({ recording_id: rec.id, stage: "upload", status: "processing", started_at: new Date().toISOString(), max_attempts: 1 });
    req.log.info({ stage: "upload", recordingId: rec.id, classId: cls.id, duplicateOf: dup?.id ?? null, termId: term?.id ?? null }, "recording created");
    if (!term) req.log.warn({ stage: "upload", recordingId: rec.id }, "no current term: video has no expiry date until an admin sets one");
    return rec;
  });

  // One MediaRecorder chunk (raw bytes). x-chunk-t = ms since recording start when it was captured.
  app.put<{ Params: { id: string; seq: string } }>("/:id/chunks/:seq", async (req) => {
    const teacher = teacherOnly(req);
    const id = uuid.parse(req.params.id);
    const seq = z.coerce.number().int().min(1).parse(req.params.seq);
    const owner = await ingestOwner(id);
    if (!owner) throw new IngestError(404, "unknown recording; create it first");
    if (owner !== teacher.id) throw new IngestError(403, "not your recording");
    const tRaw = Number(req.headers["x-chunk-t"]);

    const r = await receiveChunk(id, seq, req.body as Readable, Number.isFinite(tRaw) ? tRaw : null);
    if (!r.duplicate) {
      await db()
        .from("recordings")
        .update({ chunks_received: r.received, bytes_received: r.appendedBytes, last_chunk_at: new Date().toISOString(), status: "recording" })
        .eq("id", id)
        .in("status", ["recording", "uploading"]);
    }
    if (r.slices.length) await enqueueSlices(id, r.slices);
    return { seq, duplicate: r.duplicate, appendedUpTo: r.appendedUpTo };
  });

  // Teacher pressed stop and every chunk is on the phone. Called repeatedly until nothing is missing.
  app.post<{ Params: { id: string }; Body: { totalChunks: number } }>("/:id/finish", async (req, reply) => {
    const teacher = teacherOnly(req);
    const id = uuid.parse(req.params.id);
    const total = z.number().int().min(1).parse(req.body?.totalChunks);
    if ((await ingestOwner(id)) !== teacher.id) throw new IngestError(403, "not your recording");

    const r = await finishIngest(id, total);
    if (r.missing.length) {
      await db().from("recordings").update({ status: "uploading" }).eq("id", id).eq("status", "recording");
      return reply.code(409).send({ error: "missing chunks", missing: r.missing });
    }
    if (!r.alreadyFinished) {
      await db().from("recordings").update({ status: "processing", ended_at: new Date().toISOString() }).eq("id", id);
      await db().from("processing_jobs").update({ status: "complete", finished_at: new Date().toISOString() }).eq("recording_id", id).eq("stage", "upload");
      if (r.finalSlice) await enqueueSlices(id, [r.finalSlice]);
      logger.info({ stage: "upload", recordingId: id, chunks: total, bytes: r.meta.appendedBytes }, "recording upload complete");
      await onRecordingFinished(id);
    }
    return { ok: true };
  });
}
