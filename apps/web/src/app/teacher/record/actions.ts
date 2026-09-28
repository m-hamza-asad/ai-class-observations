"use server";

import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "@obs/shared";
import { getViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKER_URL } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  recordingId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "The lesson plan is larger than 25 MB."),
  mimeType: z.string().max(200),
});

/**
 * Step 1 of attaching today's lesson planner to a recording: create the document row (RLS only
 * allows a teacher to attach a planner to their own recording) and a one-time upload URL.
 */
export async function startPlannerUpload(input: z.infer<typeof schema>) {
  const viewer = await getViewer();
  if (viewer?.profile?.role !== "teacher") return { error: "Not signed in as a teacher." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { recordingId, fileName, size, mimeType } = parsed.data;

  const supabase = await createClient();
  const { data: rec } = await supabase.from("recordings").select("id, class_id, campus_id").eq("id", recordingId).maybeSingle();
  if (!rec) return { error: "Recording not found yet. It will be retried once the recording reaches the server." };

  const documentId = crypto.randomUUID();
  const storagePath = `${rec.campus_id}/${rec.class_id}/${rec.id}/${documentId}/${fileName.replace(/[^\w.\- ]+/g, "_")}`;
  const { error } = await supabase.from("documents").insert({
    id: documentId,
    class_id: rec.class_id,
    scope: "recording",
    recording_id: rec.id,
    type: "planner",
    file_name: fileName,
    storage_path: storagePath,
    mime_type: mimeType || null,
    size_bytes: size,
    uploaded_by: viewer.profile.id,
  });
  if (error) return { error: error.message };
  const { data: signed, error: signErr } = await createAdminClient().storage.from("documents").createSignedUploadUrl(storagePath);
  if (signErr || !signed) return { error: signErr?.message ?? "Could not prepare the upload." };
  return { documentId, path: storagePath, token: signed.token };
}

/** Step 2: file is in Storage; ask the worker to extract its text (used for the lesson-plan alignment score). */
export async function finishPlannerUpload(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  try {
    const res = await fetch(`${WORKER_URL}/documents/${documentId}/parse`, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session?.access_token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return { ok: true };
  } catch (err) {
    // the worker re-queues pending documents on startup, so this isn't lost
    console.warn(JSON.stringify({ stage: "document_parse", documentId, error: `worker unreachable: ${err}` }));
    return { ok: false };
  }
}
