/**
 * Draft observation report: Claude rates each criterion of the school's fixed framework with
 * timestamped evidence, and assesses lesson-plan alignment using the school's own prompt.
 * Percentages are computed in code (computeScores), never taken from the model's arithmetic,
 * except the alignment percentage, which the school's prompt asks the evaluator to judge directly.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { computeScores, fmtTimestamp, type FrameworkDefinition, type ReportDraft, type ReportScores } from "@obs/shared";
import { aiFake, config } from "../config.js";
import { logger } from "../lib/logger.js";
import { assertUsableResponse, claude, textOf, toStageError } from "./claude.js";

export const REPORT_PROMPT_VERSION = "report-framework-v1";
const MAX_DOC_CHARS = 60_000;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  is_flagged_unclear: boolean;
}

export interface VideoFinding {
  start_sec: number;
  end_sec: number | null;
  category: string;
  observation: string;
}

export interface ReportInput {
  definition: FrameworkDefinition;
  lesson: { className: string; subject: string | null; grade: string | null; durationSec: number; recordedAt: string };
  transcript: TranscriptSegment[];
  videoFindings: VideoFinding[] | null;
  classDocuments: { type: string; fileName: string; text: string }[];
  planner: { fileName: string; text: string } | null;
}

export interface ReportOutput {
  draft: ReportDraft;
  scores: ReportScores;
  model: string;
  provider: "anthropic" | "fake";
  usage: unknown;
  latencyMs: number;
  warnings: string[];
}

// ------------------------------------------------------------------------------------------------
// Output schema (built from the framework so category/criterion keys are constrained)
// ------------------------------------------------------------------------------------------------
export function buildSchema(def: FrameworkDefinition) {
  const catKeys = def.categories.map((c) => c.key) as [string, ...string[]];
  const critKeys = def.categories.flatMap((c) => c.criteria.map((k) => k.key)) as [string, ...string[]];
  const dimKeys = def.lesson_plan_alignment.dimensions.map((d) => d.key) as [string, ...string[]];
  const evidence = z.object({
    start_sec: z.number().describe("Seconds from the start of the recording, copied from the transcript line prefix"),
    end_sec: z.number().nullable(),
    observation: z.string(),
    quote: z.string().nullable().describe("Short quote as spoken (Roman Urdu kept as-is, with an English gloss in brackets), or null"),
    source: z.enum(["transcript", "video", "both"]),
  });
  return z.object({
    overview: z.string(),
    categories: z.array(
      z.object({
        key: z.enum(catKeys),
        summary: z.string(),
        strengths: z.string(),
        growth_areas: z.string(),
        criteria: z.array(
          z.object({
            key: z.enum(critKeys),
            rating: z.number().int().nullable().describe(`1-${def.scoring.max_rating}, or null when not observed`),
            rationale: z.string(),
            evidence: z.array(evidence),
          }),
        ),
      }),
    ),
    lesson_plan_alignment: z.object({
      assessed: z.boolean(),
      percent: z.number().int().nullable().describe("0-100 alignment score, or null when not assessed"),
      rationale: z.string(),
      dimensions: z.array(z.object({ key: z.enum(dimKeys), finding: z.string(), evidence: z.array(evidence) })),
      objectives: z.array(
        z.object({
          objective: z.string(),
          status: z.enum(["achieved", "partially_achieved", "not_achieved", "unclear"]),
          evidence: z.array(evidence),
        }),
      ),
    }),
    strengths: z.array(z.object({ text: z.string(), start_sec: z.number().nullable() })),
    recommendations: z.array(z.object({ text: z.string(), category_key: z.enum(catKeys).nullable() })),
    evidence_limits: z.string(),
  });
}

// ------------------------------------------------------------------------------------------------
// Prompt
// ------------------------------------------------------------------------------------------------
function systemPrompt(def: FrameworkDefinition): string {
  const scale = def.rating_scale.map((r) => `${r.value} = ${r.label}: ${r.description}`).join("\n");
  const framework = def.categories
    .map(
      (c, i) =>
        `${i + 1}. ${c.title} [${c.key}]\n` +
        c.criteria.map((k) => `   - ${k.title} [${k.key}] (observable via ${k.observable_via ?? "audio+video"}): ${k.guidance}`).join("\n"),
    )
    .join("\n");
  const dims = def.lesson_plan_alignment.dimensions.map((d) => `${d.title} [${d.key}]`).join(", ");

  return `You draft classroom observation reports for school administrators in Pakistan. An administrator reviews, edits and finalizes every report; your output is a draft to support their judgement, not a decision.

# The observation framework (fixed; rate every criterion)
${framework}

Rating scale:
${scale}
Use null (reported as "${def.not_observed_label}") when the recording does not give enough evidence to judge a criterion. Never guess and never default to a middle rating; an honest null is better than an unsupported number.

# Lesson plan alignment
The school's own evaluation instruction for this part is:
"${def.lesson_plan_alignment.school_prompt}"
Cover these dimensions: ${dims}. Also list the lesson's stated learning objectives (from the lesson plan) with whether each was achieved.
If no lesson plan is provided, set assessed=false and percent=null, explain that no plan was attached, and leave dimensions and objectives empty.

# Evidence rules
- Every rating and finding must rest on specific evidence from the transcript (or the video findings, when provided), with timestamps.
- Transcript lines look like "[t=125.0s | 2:05] text". Copy the seconds value into start_sec (and end_sec when a span is meaningful). Do not invent timestamps.
- Lines marked (UNCLEAR) were poorly recognised. Do not quote them as fact or base a rating on them alone.
- The speech is English mixed with Urdu, written in Roman Urdu. Quote as spoken and add a short English gloss in brackets for Urdu, e.g. "samajh aaya? [did you understand?]".
- The camera faces the teacher. Student behaviour (attentiveness, engagement, independent work) is mostly inferred from audio: say so where relevant, and prefer null when the audio does not show it.
- Class reference documents (KPIs, terms of reference, learning outcomes) describe the school's expectations. Use them as context for what good practice looks like; they do not change the framework's categories.

# Tone and framing
- Specific, balanced, respectful to the teacher, and concise. Name strengths as concretely as weaknesses.
- Do not state or imply pass/fail, eligibility, hiring, or performance-threshold outcomes, and do not mention percentages other than the lesson-plan alignment score you are asked for. Final judgements belong to the administrator.

# Sections
- overview: 3-5 sentences on the topic, lesson structure with approximate timestamps, and overall impression.
- categories: one entry per framework category, each with every one of its criteria, a short summary, strengths and growth areas.
- strengths: 3 items, each tied to a timestamp.
- recommendations: 3 prioritised, specific next steps, each linked to a framework category key.
- evidence_limits: what the recording could not show (camera angle, unclear audio, gaps, missing lesson plan).`;
}

function clip(text: string, label: string, warnings: string[]): string {
  if (text.length <= MAX_DOC_CHARS) return text;
  warnings.push(`${label} truncated from ${text.length} to ${MAX_DOC_CHARS} characters`);
  return `${text.slice(0, MAX_DOC_CHARS)}\n[... document truncated for length ...]`;
}

function userContent(input: ReportInput, warnings: string[]): string {
  const { lesson } = input;
  const parts: string[] = [];
  parts.push(
    `# Lesson\nClass: ${lesson.className}${lesson.subject ? ` · ${lesson.subject}` : ""}${lesson.grade ? ` · Grade ${lesson.grade}` : ""}\nRecorded: ${lesson.recordedAt}\nLength: ${fmtTimestamp(lesson.durationSec)} (${Math.round(lesson.durationSec)}s)`,
  );

  if (input.planner) parts.push(`# Lesson plan (attached by the teacher): ${input.planner.fileName}\n${clip(input.planner.text, "lesson plan", warnings)}`);
  else parts.push("# Lesson plan\nNo lesson plan was attached to this recording.");

  if (input.classDocuments.length) {
    parts.push(
      `# Class reference documents\n` +
        input.classDocuments.map((d) => `## ${d.type}: ${d.fileName}\n${clip(d.text, d.fileName, warnings)}`).join("\n\n"),
    );
  }

  if (input.videoFindings?.length) {
    parts.push(
      `# Video analysis findings (from a separate video model)\n` +
        input.videoFindings.map((f) => `[t=${f.start_sec.toFixed(1)}s | ${fmtTimestamp(f.start_sec)}] (${f.category}) ${f.observation}`).join("\n"),
    );
  } else {
    parts.push("# Video analysis findings\nNot available for this lesson; base the draft on the transcript and note this under evidence_limits.");
  }

  const unclear = input.transcript.filter((s) => s.is_flagged_unclear).length;
  parts.push(
    `# Transcript (${input.transcript.length} lines, ${unclear} marked UNCLEAR)\n` +
      input.transcript.map((s) => `[t=${s.start.toFixed(1)}s | ${fmtTimestamp(s.start)}]${s.is_flagged_unclear ? " (UNCLEAR)" : ""} ${s.text}`).join("\n"),
  );
  parts.push("Write the draft observation report now.");
  return parts.join("\n\n");
}

// ------------------------------------------------------------------------------------------------
// Validation: the schema constrains shape; this enforces completeness and sane values
// ------------------------------------------------------------------------------------------------
export function normalizeDraft(def: FrameworkDefinition, raw: Omit<ReportDraft, "schema_version" | "review_notice">, durationSec: number, hasPlanner: boolean, warnings: string[]): ReportDraft {
  const max = def.scoring.max_rating;
  const clampEvidence = <T extends { start_sec: number; end_sec: number | null }>(list: T[]) =>
    list
      .filter((e) => {
        const ok = Number.isFinite(e.start_sec) && e.start_sec >= 0 && e.start_sec <= durationSec + 5;
        if (!ok) warnings.push(`dropped evidence with out-of-range timestamp ${e.start_sec}`);
        return ok;
      })
      .map((e) => ({ ...e, start_sec: Math.min(e.start_sec, durationSec), end_sec: e.end_sec === null ? null : Math.min(Math.max(e.end_sec, e.start_sec), durationSec) }));

  const categories = def.categories.map((cat) => {
    const got = raw.categories.find((c) => c.key === cat.key);
    if (!got) warnings.push(`model omitted category ${cat.key}`);
    return {
      key: cat.key,
      summary: got?.summary ?? "",
      strengths: got?.strengths ?? "",
      growth_areas: got?.growth_areas ?? "",
      criteria: cat.criteria.map((crit) => {
        const c = got?.criteria.find((x) => x.key === crit.key);
        if (!c) warnings.push(`model omitted criterion ${cat.key}.${crit.key}`);
        const rating = typeof c?.rating === "number" && Number.isInteger(c.rating) && c.rating >= 1 && c.rating <= max ? c.rating : null;
        if (c && c.rating !== null && rating === null) warnings.push(`invalid rating ${c.rating} for ${crit.key} treated as not observed`);
        return { key: crit.key, rating, rationale: c?.rationale ?? "Not assessed in this draft.", evidence: clampEvidence(c?.evidence ?? []) };
      }),
    };
  });

  const a = raw.lesson_plan_alignment;
  const lesson_plan_alignment = hasPlanner
    ? {
        assessed: a.assessed,
        percent: a.assessed && typeof a.percent === "number" ? Math.max(0, Math.min(100, Math.round(a.percent))) : null,
        rationale: a.rationale,
        dimensions: a.dimensions.map((d) => ({ ...d, evidence: clampEvidence(d.evidence) })),
        objectives: a.objectives.map((o) => ({ ...o, evidence: clampEvidence(o.evidence) })),
      }
    : { assessed: false, percent: null, rationale: "No lesson plan was attached to this recording, so alignment was not assessed.", dimensions: [], objectives: [] };

  return {
    schema_version: 1,
    review_notice: def.review_notice,
    overview: raw.overview,
    categories,
    lesson_plan_alignment,
    strengths: raw.strengths.map((s) => ({ ...s, start_sec: s.start_sec !== null && s.start_sec >= 0 && s.start_sec <= durationSec + 5 ? Math.min(s.start_sec, durationSec) : null })),
    recommendations: raw.recommendations,
    evidence_limits: raw.evidence_limits,
  };
}

// ------------------------------------------------------------------------------------------------
export async function generateReport(input: ReportInput): Promise<ReportOutput> {
  const warnings: string[] = [];
  if (aiFake) return fakeReport(input, warnings);

  const schema = buildSchema(input.definition);
  const started = Date.now();
  try {
    // streamed: long transcript in, long structured report out
    const stream = claude().messages.stream({
      model: config.CLAUDE_REPORT_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(schema), effort: "high" },
      system: systemPrompt(input.definition),
      messages: [{ role: "user", content: userContent(input, warnings) }],
    });
    const msg = await stream.finalMessage();
    assertUsableResponse(msg);
    const raw = schema.parse(JSON.parse(textOf(msg)));
    const draft = normalizeDraft(input.definition, raw as Omit<ReportDraft, "schema_version" | "review_notice">, input.lesson.durationSec, Boolean(input.planner), warnings);
    if (warnings.length) logger.warn({ stage: "report_generation", warnings }, "report draft normalized with warnings");
    return { draft, scores: computeScores(input.definition, draft), model: config.CLAUDE_REPORT_MODEL, provider: "anthropic", usage: msg.usage, latencyMs: Date.now() - started, warnings };
  } catch (err) {
    throw toStageError(err);
  }
}

/** Deterministic fake (AI_FAKE=1) that exercises the full draft shape. Clearly labelled as fake. */
function fakeReport(input: ReportInput, warnings: string[]): ReportOutput {
  const t = input.transcript;
  const at = (i: number) => t[Math.min(i, t.length - 1)]?.start ?? 0;
  const raw = {
    overview: `[FAKE AI OUTPUT for pipeline testing] ${input.lesson.className} lesson, ${fmtTimestamp(input.lesson.durationSec)} long, ${t.length} transcript lines.`,
    categories: input.definition.categories.map((cat, ci) => ({
      key: cat.key,
      summary: `Fake summary for ${cat.title}.`,
      strengths: "Fake strength.",
      growth_areas: "Fake growth area.",
      criteria: cat.criteria.map((crit, ki) => ({
        key: crit.key,
        rating: (ci + ki) % 5 === 4 ? null : ((ci + ki) % 4) + 1,
        rationale: `Fake rationale for ${crit.title}.`,
        evidence: [{ start_sec: at(ki), end_sec: null, observation: "Fake observation.", quote: null, source: "transcript" as const }],
      })),
    })),
    lesson_plan_alignment: {
      assessed: Boolean(input.planner),
      percent: input.planner ? 72 : null,
      rationale: "Fake alignment rationale.",
      dimensions: input.definition.lesson_plan_alignment.dimensions.map((d) => ({ key: d.key, finding: "Fake finding.", evidence: [] })),
      objectives: [{ objective: "Fake objective", status: "partially_achieved" as const, evidence: [] }],
    },
    strengths: [{ text: "Fake strength with timestamp.", start_sec: at(0) }],
    recommendations: [{ text: "Fake recommendation.", category_key: input.definition.categories[0].key }],
    evidence_limits: "Fake: camera faces the teacher; video analysis not available.",
  };
  const draft = normalizeDraft(input.definition, raw, input.lesson.durationSec, Boolean(input.planner), warnings);
  return { draft, scores: computeScores(input.definition, draft), model: "fake-claude", provider: "fake", usage: null, latencyMs: 1, warnings };
}
