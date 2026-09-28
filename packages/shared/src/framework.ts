/**
 * The observation framework (stored in report_templates.definition) and the shape of a generated
 * report. Scores are computed here, in code, from per-criterion ratings, never by the model, so the
 * same ratings always produce the same percentages in the worker and in the admin UI.
 */

export interface FrameworkCriterion {
  key: string;
  title: string;
  guidance: string;
  observable_via?: string;
  guidance_status?: "needs_school_definition";
}

export interface FrameworkCategory {
  key: string;
  title: string;
  weight: number;
  criteria: FrameworkCriterion[];
}

export interface FrameworkDefinition {
  framework_name: string;
  review_notice: string;
  rating_scale: { value: number; label: string; description: string }[];
  not_observed_label: string;
  scoring: { method: string; max_rating: number };
  categories: FrameworkCategory[];
  lesson_plan_alignment: {
    school_prompt: string;
    dimensions: { key: string; title: string }[];
    requires: string;
  };
  sections: { key: string; title: string; kind: string; guidance?: string }[];
}

/** A timestamped observation. Times are seconds from the start of the recording. */
export interface Evidence {
  start_sec: number;
  end_sec: number | null;
  observation: string;
  /** Short quote as spoken (Roman Urdu kept as-is), optionally with an English gloss. */
  quote: string | null;
  source: "transcript" | "video" | "both";
}

export interface CriterionResult {
  key: string;
  /** 1..max_rating, or null when the recording doesn't show enough to judge. */
  rating: number | null;
  rationale: string;
  evidence: Evidence[];
}

export interface CategoryResult {
  key: string;
  summary: string;
  strengths: string;
  growth_areas: string;
  criteria: CriterionResult[];
}

export interface AlignmentResult {
  /** false when no lesson planner was attached, so alignment was not assessed. */
  assessed: boolean;
  percent: number | null;
  rationale: string;
  dimensions: { key: string; finding: string; evidence: Evidence[] }[];
  objectives: { objective: string; status: "achieved" | "partially_achieved" | "not_achieved" | "unclear"; evidence: Evidence[] }[];
}

/** What is stored in reports.sections (the editable draft). */
export interface ReportDraft {
  schema_version: 1;
  review_notice: string;
  overview: string;
  categories: CategoryResult[];
  lesson_plan_alignment: AlignmentResult;
  strengths: { text: string; start_sec: number | null }[];
  recommendations: { text: string; category_key: string | null }[];
  evidence_limits: string;
}

export interface CategoryScore {
  percent: number | null;
  observed: number;
  total: number;
  mean_rating: number | null;
}

export interface ReportScores {
  /** Weighted mean of category percents (categories with no observed criteria excluded). */
  rubric_percent: number | null;
  alignment_percent: number | null;
  categories: Record<string, CategoryScore>;
  not_observed: { category_key: string; criterion_key: string }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeScores(def: FrameworkDefinition, draft: Pick<ReportDraft, "categories" | "lesson_plan_alignment">): ReportScores {
  const max = def.scoring.max_rating;
  const categories: Record<string, CategoryScore> = {};
  const notObserved: ReportScores["not_observed"] = [];
  let weighted = 0;
  let weights = 0;

  for (const cat of def.categories) {
    const result = draft.categories.find((c) => c.key === cat.key);
    const ratings: number[] = [];
    for (const crit of cat.criteria) {
      const r = result?.criteria.find((c) => c.key === crit.key)?.rating;
      if (typeof r === "number" && r >= 1 && r <= max) ratings.push(r);
      else notObserved.push({ category_key: cat.key, criterion_key: crit.key });
    }
    const mean = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    const percent = mean === null ? null : round1((mean / max) * 100);
    categories[cat.key] = { percent, observed: ratings.length, total: cat.criteria.length, mean_rating: mean === null ? null : round1(mean) };
    if (percent !== null) {
      weighted += percent * cat.weight;
      weights += cat.weight;
    }
  }

  const a = draft.lesson_plan_alignment;
  return {
    rubric_percent: weights ? round1(weighted / weights) : null,
    alignment_percent: a.assessed && typeof a.percent === "number" ? Math.max(0, Math.min(100, Math.round(a.percent))) : null,
    categories,
    not_observed: notObserved,
  };
}

/** 125 -> "2:05", 3725 -> "1:02:05" */
export function fmtTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
