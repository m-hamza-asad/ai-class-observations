"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@obs/shared";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { WORKER_URL } from "@/lib/supabase/env";

export type ActionState = { ok?: string; error?: string } | null;

const classSchema = z.object({
  name: z.string().trim().min(1, "Enter a class name."),
  subject: z.string().trim().optional(),
  grade: z.string().trim().optional(),
  teacher_id: z.string().uuid().or(z.literal("")).optional(),
});

export async function createClass(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await assertAdmin();
  const parsed = classSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .insert({
      campus_id: admin.campus_id,
      name: parsed.data.name,
      subject: parsed.data.subject || null,
      grade: parsed.data.grade || null,
      teacher_id: parsed.data.teacher_id || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  redirect(`/admin/classes/${data.id}`);
}

export async function updateClass(_prev: ActionState, form: FormData): Promise<ActionState> {
  await assertAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const parsed = classSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({
      name: parsed.data.name,
      subject: parsed.data.subject || null,
      grade: parsed.data.grade || null,
      teacher_id: parsed.data.teacher_id || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/admin/classes/${id}`);
  revalidatePath("/admin/classes");
  return { ok: "Saved." };
}

const uploadSchema = z.object({
  classId: z.string().uuid(),
  type: z.enum(Object.keys(DOCUMENT_TYPES) as [keyof typeof DOCUMENT_TYPES, ...(keyof typeof DOCUMENT_TYPES)[]]),
  fileName: z.string().min(1).max(200),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "File is larger than 25 MB."),
  mimeType: z.string().max(200),
});

/**
 * Step 1 of a document upload: create the row and a one-time signed upload URL.
 * The browser then uploads the bytes straight to Storage (never through Vercel).
 */
export async function startDocumentUpload(input: z.infer<typeof uploadSchema>) {
  const admin = await assertAdmin();
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { classId, type, fileName, size, mimeType } = parsed.data;

  const supabase = await createClient();
  const { data: cls } = await supabase.from("classes").select("id, campus_id").eq("id", classId).maybeSingle();
  if (!cls || cls.campus_id !== admin.campus_id) return { error: "Class not found." };

  const documentId = crypto.randomUUID();
  const safeName = fileName.replace(/[^\w.\- ]+/g, "_");
  const storagePath = `${cls.campus_id}/${cls.id}/${documentId}/${safeName}`;

  const { error: insErr } = await supabase.from("documents").insert({
    id: documentId,
    class_id: classId,
    scope: "class",
    type,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: mimeType || null,
    size_bytes: size,
    uploaded_by: admin.id,
  });
  if (insErr) return { error: insErr.message };

  const { data: signed, error: signErr } = await createAdminClient().storage.from("documents").createSignedUploadUrl(storagePath);
  if (signErr || !signed) return { error: signErr?.message ?? "Could not create upload URL." };
  return { documentId, path: storagePath, token: signed.token };
}

/** Step 2: the file is in Storage; ask the worker to parse it. If the worker is unreachable the
 *  document stays 'pending' and the worker picks it up when it next starts. */
export async function finishDocumentUpload(documentId: string): Promise<ActionState> {
  await assertAdmin();
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  try {
    const res = await fetch(`${WORKER_URL}/documents/${documentId}/parse`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (err) {
    console.warn(JSON.stringify({ stage: "document_parse", documentId, error: `worker unreachable: ${err}` }));
    return { error: "Uploaded, but the processing service didn't respond. It will be processed automatically when the service is back." };
  } finally {
    const { data: doc } = await supabase.from("documents").select("class_id").eq("id", documentId).maybeSingle();
    if (doc) revalidatePath(`/admin/classes/${doc.class_id}`);
  }
  return { ok: "Uploaded. Extracting text…" };
}

/** Documents are never hard-deleted: reports must stay traceable to what they were based on. */
export async function removeDocument(_prev: ActionState, form: FormData): Promise<ActionState> {
  await assertAdmin();
  const id = z.string().uuid().parse(form.get("documentId"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").update({ superseded_at: new Date().toISOString() }).eq("id", id).select("class_id").single();
  if (error) return { error: error.message };
  revalidatePath(`/admin/classes/${data.class_id}`);
  return { ok: "Removed." };
}

export async function retryDocumentParse(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = z.string().uuid().parse(form.get("documentId"));
  return finishDocumentUpload(id);
}
