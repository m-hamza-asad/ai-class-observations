import Link from "next/link";
import { notFound } from "next/navigation";
import type { FrameworkDefinition, ReportDraft, ReportScores } from "@obs/shared";
import AutoRefresh from "@/components/AutoRefresh";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtBytes, fmtDate, fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STATUS_BADGE } from "../status";
import ReviewWorkspace, { type TranscriptSegment } from "./ReviewWorkspace";

export const metadata = { title: "Recording · Observe" };

const STAGES = [
  { stage: "upload", label: "Upload" },
  { stage: "transcription", label: "Transcription" },
  { stage: "normalization", label: "Video processing" },
  { stage: "video_analysis", label: "Video analysis" },
  { stage: "report_generation", label: "Draft report" },
] as const;

export default async function RecordingDetail({ params }: PageProps<"/admin/recordings/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: rec } = await supabase
    .from("recordings")
    .select("*, classes(name, subject, grade), profiles!recordings_teacher_id_fkey(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!rec) notFound();

  const [{ data: jobs }, { data: slices }, { data: transcript }, { data: report }, { data: planner }] = await Promise.all([
    supabase.from("processing_jobs").select("stage, status, attempt_count, max_attempts, error_detail, updated_at").eq("recording_id", id).order("created_at"),
    supabase.from("transcription_slices").select("status").eq("recording_id", id),
    supabase.from("transcripts").select("segments").eq("recording_id", id).maybeSingle(),
    supabase.from("reports").select("status, sections, scores, template_id, report_templates(definition)").eq("recording_id", id).maybeSingle(),
    supabase.from("documents").select("file_name, parse_status").eq("recording_id", id).eq("type", "planner").is("superseded_at", null).maybeSingle(),
  ]);

  let videoUrl: string | null = null;
  if (rec.video_path && !rec.video_deleted_at) {
    const { data } = await supabase.storage.from("recordings").createSignedUrl(rec.video_path, 60 * 60 * 3);
    videoUrl = data?.signedUrl ?? null;
  }

  const inFlight = ["recording", "uploading", "processing"].includes(rec.status);
  const badge = report?.status === "final" ? { label: "Final", tone: "green" as const } : STATUS_BADGE[rec.status];
  const sliceDone = slices?.filter((s) => s.status === "complete").length ?? 0;

  return (
    <>
      <AutoRefresh active={inFlight} intervalMs={4000} />
      <div className="mb-2 text-sm">
        <Link href="/admin/recordings" className="text-neutral-500 hover:underline">
          ← Recordings
        </Link>
      </div>
      <PageHeader
        title={`${rec.classes?.name ?? "Lesson"} · ${fmtDate(rec.recorded_at)}`}
        description={`${rec.profiles?.full_name || rec.profiles?.email} · started ${fmtDateTime(rec.recorded_at)}${rec.duration_sec ? ` · ${Math.round(Number(rec.duration_sec) / 60)} min` : ""}`}
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      {rec.possible_duplicate_of && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This recording started shortly after{" "}
          <Link className="underline" href={`/admin/recordings/${rec.possible_duplicate_of}`}>
            another recording
          </Link>{" "}
          by the same teacher for the same class. It may be an accidental double recording.
        </p>
      )}
      {rec.status === "failed" && (
        <p className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="font-semibold">Processing failed.</span> {rec.error_detail}
        </p>
      )}

      <Card className="mb-6">
        <ol className="grid gap-3 sm:grid-cols-5">
          {STAGES.map(({ stage, label }) => {
            const job = [...(jobs ?? [])].reverse().find((j) => j.stage === stage);
            const tone = !job ? "neutral" : job.status === "complete" ? "green" : job.status === "failed" ? "red" : "blue";
            const text =
              stage === "video_analysis" && !job
                ? "not built yet"
                : !job
                  ? "waiting"
                  : job.status === "processing" && stage === "transcription"
                    ? `${sliceDone}/${slices?.length ?? 0} min transcribed`
                    : job.status === "pending" && job.attempt_count > 0
                      ? `retrying (${job.attempt_count}/${job.max_attempts})`
                      : job.status;
            return (
              <li key={stage} className="text-sm">
                <div className="font-medium">{label}</div>
                <Badge tone={tone}>{text}</Badge>
                {job?.error_detail && <p className="mt-1 text-xs text-red-600">{job.error_detail}</p>}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-neutral-500">
          {rec.chunks_received} parts · {fmtBytes(rec.bytes_received)} received
          {rec.last_chunk_at && ` · last upload ${fmtDateTime(rec.last_chunk_at)}`}
          {" · lesson plan: "}
          {planner ? `${planner.file_name} (${planner.parse_status})` : "none attached"}
          {rec.semester_expiry_date ? ` · video kept until ${fmtDate(rec.semester_expiry_date)}` : " · no term set, so no video expiry date"}
        </p>
      </Card>

      <ReviewWorkspace
        videoUrl={videoUrl}
        segments={(transcript?.segments as unknown as TranscriptSegment[]) ?? null}
        draft={(report?.sections as unknown as ReportDraft) ?? null}
        scores={(report?.scores as unknown as ReportScores) ?? null}
        definition={(report?.report_templates?.definition as unknown as FrameworkDefinition) ?? null}
        reportStatus={report?.status ?? null}
      />
    </>
  );
}
