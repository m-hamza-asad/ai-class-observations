import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import ClassForm from "./ClassForm";

export const metadata = { title: "Classes · Observe" };

export default async function ClassesPage() {
  const supabase = await createClient();
  const [{ data: classes }, { data: teachers }, { data: docs }] = await Promise.all([
    supabase.from("classes").select("id, name, subject, grade, teacher_id").is("archived_at", null).order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("role", "teacher").is("deactivated_at", null).order("full_name"),
    supabase.from("documents").select("class_id, parse_status").eq("scope", "class").is("superseded_at", null),
  ]);
  const teacherName = new Map(teachers?.map((t) => [t.id, t.full_name || t.email]) ?? []);

  return (
    <>
      <PageHeader title="Classes" description="Each class has one teacher and its own reference documents (KPIs, TORs, learning outcomes)." />
      <Card title="New class" className="mb-6">
        {teachers?.length ? null : (
          <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
            No teachers yet. You can create classes now and assign teachers after <Link className="underline" href="/admin/teachers">inviting them</Link>.
          </p>
        )}
        <ClassForm teachers={teachers ?? []} />
      </Card>
      <Card title={`All classes (${classes?.length ?? 0})`}>
        {!classes?.length ? (
          <EmptyState>No classes yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {classes.map((c) => {
              const classDocs = docs?.filter((d) => d.class_id === c.id) ?? [];
              const ready = classDocs.filter((d) => d.parse_status === "complete").length;
              return (
                <li key={c.id}>
                  <Link href={`/admin/classes/${c.id}`} className="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    <div className="min-w-48 flex-1">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm text-neutral-500">
                        {[c.subject, c.grade && `Grade ${c.grade}`].filter(Boolean).join(" · ") || "No subject set"} ·{" "}
                        {c.teacher_id ? teacherName.get(c.teacher_id) ?? "Unknown teacher" : <span className="text-amber-700 dark:text-amber-400">no teacher</span>}
                      </div>
                    </div>
                    <Badge tone={ready ? "blue" : "neutral"}>{ready} document{ready === 1 ? "" : "s"}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
