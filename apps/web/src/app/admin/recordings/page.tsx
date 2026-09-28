import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STATUS_BADGE } from "./status";

export const metadata = { title: "Recordings · Observe" };

export default async function RecordingsPage() {
  const supabase = await createClient();
  const [{ data: recs }, { data: reports }] = await Promise.all([
    supabase
      .from("recordings")
      .select("id, status, recorded_at, duration_sec, possible_duplicate_of, error_detail, classes(name), profiles!recordings_teacher_id_fkey(full_name, email)")
      .order("recorded_at", { ascending: false })
      .limit(100),
    supabase.from("reports").select("recording_id, status, scores"),
  ]);
  const reportOf = new Map(reports?.map((r) => [r.recording_id, r]));
  const inFlight = recs?.some((r) => ["recording", "uploading", "processing"].includes(r.status)) ?? false;

  return (
    <>
      <AutoRefresh active={inFlight} intervalMs={5000} />
      <PageHeader title="Recordings" description="Lessons recorded by teachers, their processing status and draft reports." />
      <Card>
        {!recs?.length ? (
          <EmptyState>No recordings yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {recs.map((r) => {
              const report = reportOf.get(r.id);
              const scores = report?.scores as { rubric_percent: number | null; alignment_percent: number | null } | null;
              const badge = report?.status === "final" ? { label: "Final", tone: "green" as const } : STATUS_BADGE[r.status];
              return (
                <li key={r.id}>
                  <Link href={`/admin/recordings/${r.id}`} className="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    <div className="min-w-56 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {r.classes?.name ?? "Class"}
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {r.possible_duplicate_of && <Badge tone="amber">possible duplicate</Badge>}
                      </div>
                      <div className="text-sm text-neutral-500">
                        {r.profiles?.full_name || r.profiles?.email} · {fmtDateTime(r.recorded_at)}
                        {r.duration_sec ? ` · ${Math.round(Number(r.duration_sec) / 60)} min` : ""}
                      </div>
                      {r.status === "failed" && r.error_detail && <div className="text-sm text-red-600">{r.error_detail}</div>}
                    </div>
                    {scores && (
                      <div className="text-right text-sm tabular-nums">
                        <div>
                          Framework {scores.rubric_percent ?? "—"}
                          {scores.rubric_percent !== null && "%"}
                        </div>
                        <div className="text-neutral-500">
                          Plan alignment {scores.alignment_percent ?? "n/a"}
                          {scores.alignment_percent !== null && "%"}
                        </div>
                        {report?.status !== "final" && <div className="text-xs text-amber-700 dark:text-amber-400">AI draft · not reviewed</div>}
                      </div>
                    )}
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
