import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { db } from "../lib/supabase.js";
import { PermanentError, runTracked } from "./tracking.js";

export interface DocumentParseData {
  jobRowId: string;
  documentId: string;
}

const MAX_CHARS = 400_000;

export async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  let text: string;
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractPdfText(pdf, { mergePages: true })).text;
  } else if (ext === "docx") {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (["txt", "md", "csv"].includes(ext)) {
    text = buf.toString("utf8");
  } else {
    throw new PermanentError(`Unsupported file type ".${ext}". Upload PDF, DOCX or TXT (old .doc files: re-save as .docx).`);
  }
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 20) {
    throw new PermanentError("No readable text found. If this is a scanned PDF, upload a text-based PDF or DOCX instead.");
  }
  return text.slice(0, MAX_CHARS);
}

export async function handleDocumentParse(data: DocumentParseData, retryCount: number, retryLimit: number) {
  const { documentId } = data;
  const { data: doc, error } = await db().from("documents").select("id, class_id, file_name, storage_path").eq("id", documentId).single();
  if (error || !doc) throw new Error(`document ${documentId} not found: ${error?.message}`);
  const ref = { stage: "document_parse" as const, documentId, classId: doc.class_id };

  await runTracked(
    ref,
    { jobRowId: data.jobRowId, retryCount, retryLimit },
    async () => {
      await db().from("documents").update({ parse_status: "processing", parse_error: null }).eq("id", documentId);
      const { data: file, error: dlErr } = await db().storage.from("documents").download(doc.storage_path);
      if (dlErr || !file) throw new Error(`download failed: ${dlErr?.message ?? "no data"}`);
      const text = await extractText(Buffer.from(await file.arrayBuffer()), doc.file_name);
      const { error: upErr } = await db()
        .from("documents")
        .update({ parsed_text: text, parse_status: "complete", parse_error: null })
        .eq("id", documentId);
      if (upErr) throw upErr;
    },
    async (message) => {
      await db().from("documents").update({ parse_status: "failed", parse_error: message }).eq("id", documentId);
    },
  );
}
