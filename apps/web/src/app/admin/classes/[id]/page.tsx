import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCUMENT_TYPES } from "@obs/shared";
import AutoRefresh from "@/components/AutoRefresh";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import ClassForm from "../ClassForm";
import DocumentActions from "./DocumentActions";
import DocumentUploader from "./DocumentUploader";

const STATUS_BADGE = {
  pending: <Badge tone="neutral">Queued</Badge>,
  processing: <Badge tone="blue">Extracting text…</Badge>,
  complete: <Badge tone="green">Ready</Badge>,
  failed: <Badge tone="red">Failed</Badge>,
} as const;

export async function generateMetadata({ params }: PageProps<"/admin/classes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("classes").select("name").eq("id", id).maybeSingle();
  return { title: `${data?.name ?? "Class"} · Observe` };
}

export default async function ClassDetailPage({ params }: PageProps<"/admin/classes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: cls }, { data: teachers }, { data: docs }] = await Promise.all([
    supabase.from("classes").select("*").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email").eq("role", "teacher").is("deactivated_at", null).order("full_name"),
    supabase
      .from("documents")
      .select("id, type, file_name, size_bytes, parse_status, parse_error, uploaded_at, parsed_text")
      .eq("class_id", id)
      .eq("scope", "class")
      .is("superseded_at", null)
      .order("uploaded_at", { ascending: false }),
  ]);
  if (!cls) notFound();

  const inFlight = docs?.some((d) => d.parse_status === "pending" || d.parse_status === "processing") ?? false;

  return (
    <>
      <AutoRefresh active={inFlight} />
      <div className="mb-2 text-sm">
        <Link href="/admin/classes" className="text-neutral-500 hover:underline">
          ← Classes
        </Link>
      </div>
      <PageHeader title={cls.name} description={[cls.subject, cls.grade && `Grade ${cls.grade}`].filter(Boolean).join(" · ") || undefined} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Reference documents">
            <p className="mb-4 text-sm text-neutral-500">
              KPIs, terms of reference and learning outcomes for this class. They give the AI context for the report narrative and the lesson-plan alignment score.
              Each day&apos;s lesson planner is attached by the teacher to the recording itself.
            </p>
            <DocumentUploader classId={cls.id} />
            <div className="mt-5">
              {!docs?.length ? (
                <EmptyState>No documents yet. Upload the teacher KPIs, TORs and learning outcomes.</EmptyState>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {docs.map((d) => (
                    <li key={d.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.file_name}</span>
                        <Badge>{DOCUMENT_TYPES[d.type]}</Badge>
                        {STATUS_BADGE[d.parse_status]}
                        <span className="ml-auto">
                          <DocumentActions documentId={d.id} canRetry={d.parse_status === "failed"} />
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500">
                        {fmtBytes(d.size_bytes)} · uploaded {fmtDateTime(d.uploaded_at)}
                        {d.parse_status === "complete" && d.parsed_text && ` · ${d.parsed_text.length.toLocaleString()} characters extracted`}
                      </div>
                      {d.parse_status === "failed" && d.parse_error && <p className="mt-1 text-sm text-red-600">{d.parse_error}</p>}
                      {d.parse_status === "complete" && d.parsed_text && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-blue-800 dark:text-blue-400">Preview extracted text</summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-900">
                            {d.parsed_text.slice(0, 4000)}
                            {d.parsed_text.length > 4000 && "\n…"}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <ClassForm teachers={teachers ?? []} initial={cls} compact />
          </Card>
          <Card title="How lessons are scored">
            <p className="text-sm text-neutral-500">
              Every lesson is scored against the school&apos;s fixed observation framework (the same for all classes), plus a separate lesson-plan alignment
              percentage when the teacher attaches a planner.{" "}
              <Link href="/admin/framework" className="text-blue-800 underline dark:text-blue-400">
                View the framework
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
