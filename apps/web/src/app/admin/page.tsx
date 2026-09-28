import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { currentTerm, fmtDate } from "@/lib/format";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Overview · Observe" };

export default async function AdminOverview() {
  const { profile } = await requireRole("admin");
  const supabase = await createClient();
  const [{ data: campus }, { count: teachers }, { count: classes }, { count: docs }, { count: recordings }, { data: terms }, { count: rubrics }] = await Promise.all([
    supabase.from("campuses").select("name").eq("id", profile.campus_id).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher").is("deactivated_at", null),
    supabase.from("classes").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("parse_status", "complete").is("superseded_at", null),
    supabase.from("recordings").select("id", { count: "exact", head: true }),
    supabase.from("academic_terms").select("*"),
    supabase.from("rubrics").select("id", { count: "exact", head: true }).eq("status", "ready"),
  ]);
  const term = currentTerm(terms ?? []);

  const steps = [
    { done: Boolean(term), label: "Add the current term", href: "/admin/terms" },
    { done: (teachers ?? 0) > 0, label: "Invite teachers", href: "/admin/teachers" },
    { done: (classes ?? 0) > 0, label: "Create classes and assign teachers", href: "/admin/classes" },
    { done: (docs ?? 0) > 0, label: "Upload KPIs / TORs / learning outcomes per class", href: "/admin/classes" },
    { done: (rubrics ?? 0) > 0, label: "Derive each class's rubric", href: "/admin/classes" },
  ];

  const stats = [
    { label: "Teachers", value: teachers ?? 0 },
    { label: "Classes", value: classes ?? 0 },
    { label: "Documents", value: docs ?? 0 },
    { label: "Recordings", value: recordings ?? 0 },
  ];

  return (
    <>
      <PageHeader title={campus?.name ?? "Overview"} description={term ? `Current term: ${term.name} (ends ${fmtDate(term.ends_on)})` : "No current term set"} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-sm text-neutral-500">{s.label}</div>
          </div>
        ))}
      </div>
      <Card title="Setup">
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-green-600 text-white" : "border border-neutral-300 text-neutral-500 dark:border-neutral-700"}`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <Link href={s.href} className={s.done ? "text-neutral-500 line-through decoration-neutral-300" : "font-medium hover:underline"}>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
