"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, type DocumentTypeKey } from "@obs/shared";
import { Button, Field, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { finishDocumentUpload, startDocumentUpload } from "../actions";

const CLASS_DOC_TYPES: DocumentTypeKey[] = ["kpis", "tors", "learning_outcomes", "other"];

export default function DocumentUploader({ classId }: { classId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentTypeKey>("kpis");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    let done = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_DOCUMENT_BYTES) {
        setMsg({ error: `${file.name} is larger than 25 MB.` });
        continue;
      }
      const start = await startDocumentUpload({ classId, type, fileName: file.name, size: file.size, mimeType: file.type });
      if ("error" in start && start.error) {
        setMsg({ error: `${file.name}: ${start.error}` });
        continue;
      }
      const { path, token, documentId } = start as { path: string; token: string; documentId: string };
      const { error } = await supabase.storage.from("documents").uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
      if (error) {
        setMsg({ error: `${file.name}: upload failed (${error.message})` });
        continue;
      }
      const res = await finishDocumentUpload(documentId);
      if (res?.error) setMsg(res);
      done++;
    }
    if (done) setMsg((m) => m ?? { ok: `${done} file${done === 1 ? "" : "s"} uploaded. Extracting text…` });
    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
        <Field label="Document type">
          <Select value={type} onChange={(e) => setType(e.target.value as DocumentTypeKey)} disabled={busy}>
            {CLASS_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPES[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={inputRef} type="file" multiple accept={DOCUMENT_ACCEPT} className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Choose files…"}
          </Button>
          <span className="text-xs text-neutral-500">PDF, DOCX or TXT · up to 25 MB each</span>
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.error ? "text-red-600" : "text-green-700 dark:text-green-400"}`}>{msg.error ?? msg.ok}</p>}
    </div>
  );
}
