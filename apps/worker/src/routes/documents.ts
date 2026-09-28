import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { db } from "../lib/supabase.js";
import { enqueueDocumentParse } from "../queue.js";

export async function documentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Called by the admin UI after the file has landed in Storage.
  app.post<{ Params: { id: string } }>("/:id/parse", { preHandler: requireAdmin }, async (req, reply) => {
    const { data: doc } = await db()
      .from("documents")
      .select("id, class_id, classes!inner(campus_id)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!doc || doc.classes.campus_id !== req.profile!.campus_id) return reply.code(404).send({ error: "document not found" });
    const jobId = await enqueueDocumentParse(doc.id, doc.class_id);
    return { jobId };
  });
}
