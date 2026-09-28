"use client";

import { useRef } from "react";
import { fmtTimestamp, type Evidence, type FrameworkDefinition, type ReportDraft, type ReportScores } from "@obs/shared";
import { Badge } from "@/components/ui";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  text_original: string | null;
  confidence: number;
  is_flagged_unclear: boolean;
}

interface Props {
  videoUrl: string | null;
  segments: TranscriptSegment[] | null;
  draft: ReportDraft | null;
  scores: ReportScores | null;
  definition: FrameworkDefinition | null;
  reportStatus: "draft" | "final" | null;
}

/** Video + transcript + draft report, with every timestamp clickable to seek the video. */
export default function ReviewWorkspace({ videoUrl, segments, draft, scores, definition, reportStatus }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    void v.play().catch(() => undefined);
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const Stamp = ({ sec }: { sec: number | null }) =>
    sec === null ? null : (
      <button onClick={() => seek(sec)} className="rounded bg-blue-50 px-1.5 font-mono text-xs text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300" title="Play from here">
        {fmtTimestamp(sec)}
      </button>
    );
  const unclear = segments?.filter((s) => s.is_flagged_unclear).length ?? 0;
  const ratingLabel = (r: number | null) => (r === null ? definition?.not_observed_label ?? "Not observed" : `${r} · ${definition?.rating_scale.find((x) => x.value === r)?.label ?? ""}`);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* ---------------- report ---------------- */}
      <div className="order-2 space-y-4 lg:order-1">
        {!draft || !definition ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">The draft report appears here once processing finishes.</p>
        ) : (
          <>
            {reportStatus !== "final" && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">AI-generated draft: not reviewed</p>
                <p>{draft.review_notice}</p>
              </div>
            )}

            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
              <div className="grid grid-cols-2 gap-3">
                <Score label="Observation framework" value={scores?.rubric_percent ?? null} note={scores ? `${Object.values(scores.categories).filter((c) => c.percent !== null).length} of ${definition.categories.length} categories with evidence` : ""} />
                <Score
                  label="Lesson plan alignment"
                  value={scores?.alignment_percent ?? null}
                  note={draft.lesson_plan_alignment.assessed ? "vs the attached lesson plan" : "No lesson plan attached"}
                />
              </div>
              <p className="mt-3 text-xs text-neutral-500">Suggested scores for the reviewer to confirm or adjust. They are not a decision.</p>
            </section>

            <Section title="Lesson overview">
              <p className="text-sm">{draft.overview}</p>
            </Section>

            {definition.categories.map((cat, i) => {
              const res = draft.categories.find((c) => c.key === cat.key);
              const sc = scores?.categories[cat.key];
              return (
                <Section
                  key={cat.key}
                  title={`${i + 1}. ${cat.title}`}
                  right={<span className="text-sm tabular-nums text-neutral-500">{sc?.percent !== null && sc?.percent !== undefined ? `${sc.percent}% · ${sc.observed}/${sc.total} observed` : "no evidence"}</span>}
                >
                  {res?.summary && <p className="mb-3 text-sm">{res.summary}</p>}
                  <ul className="space-y-3">
                    {cat.criteria.map((crit) => {
                      const c = res?.criteria.find((x) => x.key === crit.key);
                      return (
                        <li key={crit.key} className="text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{crit.title}</span>
                            <Badge tone={c?.rating ? (c.rating >= 3 ? "green" : c.rating === 2 ? "amber" : "red") : "neutral"}>{ratingLabel(c?.rating ?? null)}</Badge>
                          </div>
                          {c?.rationale && <p className="text-neutral-600 dark:text-neutral-400">{c.rationale}</p>}
                          <EvidenceList items={c?.evidence ?? []} Stamp={Stamp} />
                        </li>
                      );
                    })}
                  </ul>
                  {(res?.strengths || res?.growth_areas) && (
                    <div className="mt-3 grid gap-2 border-t border-neutral-100 pt-3 text-sm sm:grid-cols-2 dark:border-neutral-800">
                      {res.strengths && (
                        <p>
                          <span className="font-medium">Strengths: </span>
                          {res.strengths}
                        </p>
                      )}
                      {res.growth_areas && (
                        <p>
                          <span className="font-medium">To develop: </span>
                          {res.growth_areas}
                        </p>
                      )}
                    </div>
                  )}
                </Section>
              );
            })}

            <Section title="Lesson plan alignment">
              <p className="text-sm">{draft.lesson_plan_alignment.rationale}</p>
              {draft.lesson_plan_alignment.dimensions.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm">
                  {draft.lesson_plan_alignment.dimensions.map((d) => (
                    <li key={d.key}>
                      <span className="font-medium">{definition.lesson_plan_alignment.dimensions.find((x) => x.key === d.key)?.title ?? d.key}: </span>
                      {d.finding}
                      <EvidenceList items={d.evidence} Stamp={Stamp} />
                    </li>
                  ))}
                </ul>
              )}
              {draft.lesson_plan_alignment.objectives.length > 0 && (
                <>
                  <h4 className="mt-3 text-sm font-medium">Learning objectives</h4>
                  <ul className="mt-1 space-y-1 text-sm">
                    {draft.lesson_plan_alignment.objectives.map((o, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Badge tone={o.status === "achieved" ? "green" : o.status === "partially_achieved" ? "amber" : o.status === "not_achieved" ? "red" : "neutral"}>{o.status.replace("_", " ")}</Badge>
                        {o.objective}
                        {o.evidence.map((e, j) => (
                          <Stamp key={j} sec={e.start_sec} />
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Section title="Key strengths">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {draft.strengths.map((s, i) => (
                  <li key={i}>
                    {s.text} <Stamp sec={s.start_sec} />
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Recommendations">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {draft.recommendations.map((r, i) => (
                  <li key={i}>
                    {r.text}
                    {r.category_key && <span className="text-neutral-500"> ({definition.categories.find((c) => c.key === r.category_key)?.title})</span>}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Evidence limitations">
              <p className="text-sm">{draft.evidence_limits}</p>
              {scores && scores.not_observed.length > 0 && (
                <p className="mt-2 text-sm text-neutral-500">
                  Not observed (excluded from scores):{" "}
                  {scores.not_observed
                    .map((n) => definition.categories.find((c) => c.key === n.category_key)?.criteria.find((k) => k.key === n.criterion_key)?.title ?? n.criterion_key)
                    .join(", ")}
                  .
                </p>
              )}
            </Section>
          </>
        )}
      </div>

      {/* ---------------- video + transcript ---------------- */}
      <div className="order-1 space-y-4 lg:sticky lg:top-20 lg:order-2 lg:self-start">
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-900">Video not available yet</div>
        )}
        <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
            <h3 className="font-semibold">Transcript</h3>
            {segments && (
              <span className="text-xs text-neutral-500">
                {segments.length} lines · <span className="text-amber-700 dark:text-amber-400">{unclear} unclear</span>
              </span>
            )}
          </div>
          {!segments ? (
            <p className="p-4 text-sm text-neutral-500">Transcript appears here once transcription finishes.</p>
          ) : (
            <ol className="max-h-[60vh] space-y-1 overflow-auto p-3 text-sm lg:max-h-[50vh]">
              {segments.map((s, i) => (
                <li key={i} className={`flex gap-2 rounded px-1 ${s.is_flagged_unclear ? "bg-amber-50 dark:bg-amber-950/50" : ""}`}>
                  <Stamp sec={s.start} />
                  <span className={s.is_flagged_unclear ? "italic text-neutral-500" : ""}>
                    {s.text}
                    {s.is_flagged_unclear && (
                      <span className="ml-1 text-xs not-italic text-amber-700 dark:text-amber-400" title={`Recognition confidence ${Math.round(s.confidence * 100)}%`}>
                        (unclear)
                      </span>
                    )}
                    {s.text_original && (
                      <span className="block text-xs text-neutral-400" dir="auto">
                        {s.text_original}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Score({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div>
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="text-3xl font-semibold tabular-nums">{value === null ? "—" : `${value}%`}</div>
      <div className="text-xs text-neutral-500">{note}</div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function EvidenceList({ items, Stamp }: { items: Evidence[]; Stamp: (p: { sec: number | null }) => React.ReactNode }) {
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-1">
      {items.map((e, i) => (
        <li key={i} className="flex gap-2 text-neutral-600 dark:text-neutral-400">
          <Stamp sec={e.start_sec} />
          <span>
            {e.observation}
            {e.quote && <span className="italic"> &ldquo;{e.quote}&rdquo;</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
