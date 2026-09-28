import type { FastifyInstance } from "fastify";
import { authenticate } from "../lib/auth.js";
import { db } from "../lib/supabase.js";
import { enqueueDocumentParse } from "../queue.js";

export async function documentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Called after a file has landed in Storage: by admins for class documents, and by teachers for
  // the lesson planner they attached to their own recording.
  app.post<{ Params: { id: string } }>("/:id/parse", async (req, reply) => {
    const { data: doc } = await db()
      .from("documents")
      .select("id, class_id, scope, recording_id, classes!inner(campus_id), recordings(teacher_id)")
      .eq("id", req.params.id)
      .maybeSingle();
    const me = req.profile!;
    const allowed =
      doc &&
      ((me.role === "admin" && doc.classes.campus_id === me.campus_id) ||
        (me.role === "teacher" && doc.scope === "recording" && doc.recordings?.teacher_id === me.id));
    if (!allowed) return reply.code(404).send({ error: "document not found" });
    const jobId = await enqueueDocumentParse(doc.id, doc.class_id);
    return { jobId };
  });
}
