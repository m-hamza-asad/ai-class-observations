import Link from "next/link";
import PendingUploads from "@/components/PendingUploads";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "My classes · Observe" };

const STATUS: Record<string, { label: string; tone: "neutral" | "blue" | "green" | "amber" | "red" }> = {
  recording: { label: "Uploading", tone: "blue" },
  uploading: { label: "Uploading", tone: "blue" },
  processing: { label: "Processing", tone: "blue" },
  ready: { label: "With your administrator for review", tone: "amber" },
  failed: { label: "Processing problem (your administrator can see it)", tone: "red" },
};

export default async function TeacherHome() {
  const { profile } = await requireRole("teacher");
  const supabase = await createClient();
  // RLS limits all of these to the teacher's own classes, recordings and *finalized* reports
  const [{ data: classes }, { data: recordings }, { data: finalReports }] = await Promise.all([
    supabase.from("classes").select("id, name, subject, grade").is("archived_at", null).order("name"),
    supabase.from("recordings").select("id, class_id, status, recorded_at, duration_sec").order("recorded_at", { ascending: false }).limit(30),
    supabase.from("reports").select("recording_id"),
  ]);
  const finalized = new Set(finalReports?.map((r) => r.recording_id));
  const className = new Map(classes?.map((c) => [c.id, c.name]));

  return (
    <>
      <PendingUploads />
      <PageHeader title={`Hello, ${profile.full_name.split(" ")[0] || "there"}`} description="Record a lesson, and see your past recordings and finalized reports." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="My classes">
          {!classes?.length ? (
            <EmptyState>You haven&apos;t been assigned any classes yet. Ask your administrator.</EmptyState>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-neutral-500">{[c.subject, c.grade && `Grade ${c.grade}`].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Link href={`/teacher/record?class=${c.id}`} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-700">
                    Record lesson
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="My recordings">
          {!recordings?.length ? (
            <EmptyState>No recordings yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {recordings.map((r) => {
                const s = finalized.has(r.id) ? { label: "Report finalized", tone: "green" as const } : STATUS[r.status];
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{className.get(r.class_id) ?? "Class"}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <div className="text-sm text-neutral-500">
                      {fmtDateTime(r.recorded_at)}
                      {r.duration_sec ? ` · ${Math.round(Number(r.duration_sec) / 60)} min` : ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
