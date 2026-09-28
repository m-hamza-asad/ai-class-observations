import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScores, type CriterionResult, type FrameworkDefinition } from "@obs/shared";
import { normalizeDraft } from "./report.js";
import { isUnclear } from "./transcribe.js";

const def = {
  framework_name: "t",
  review_notice: "draft",
  rating_scale: [],
  not_observed_label: "Not observed",
  scoring: { method: "", max_rating: 4 },
  categories: [
    { key: "a", title: "A", weight: 1, criteria: [{ key: "a1", title: "", guidance: "" }, { key: "a2", title: "", guidance: "" }] },
    { key: "b", title: "B", weight: 1, criteria: [{ key: "b1", title: "", guidance: "" }] },
    { key: "c", title: "C", weight: 1, criteria: [{ key: "c1", title: "", guidance: "" }] },
  ],
  lesson_plan_alignment: { school_prompt: "", dimensions: [], requires: "" },
  sections: [],
} satisfies FrameworkDefinition;

const crit = (key: string, rating: number | null): CriterionResult => ({ key, rating, rationale: "", evidence: [] });
const cat = (key: string, criteria: ReturnType<typeof crit>[]) => ({ key, summary: "", strengths: "", growth_areas: "", criteria });
const noAlign = { assessed: false, percent: null, rationale: "", dimensions: [], objectives: [] };

test("category percent = mean observed rating / 4; not-observed excluded, not zero", () => {
  const s = computeScores(def, { categories: [cat("a", [crit("a1", 4), crit("a2", null)]), cat("b", [crit("b1", 2)]), cat("c", [crit("c1", null)])], lesson_plan_alignment: noAlign });
  assert.equal(s.categories.a.percent, 100);
  assert.equal(s.categories.a.observed, 1);
  assert.equal(s.categories.b.percent, 50);
  assert.equal(s.categories.c.percent, null);
  // overall: mean of categories that have evidence (a=100, b=50); c is excluded
  assert.equal(s.rubric_percent, 75);
  assert.deepEqual(s.not_observed, [{ category_key: "a", criterion_key: "a2" }, { category_key: "c", criterion_key: "c1" }]);
  assert.equal(s.alignment_percent, null);
});

test("no observed criteria at all gives a null overall score, not 0%", () => {
  const s = computeScores(def, { categories: [], lesson_plan_alignment: noAlign });
  assert.equal(s.rubric_percent, null);
});

test("normalizeDraft fills omitted criteria, rejects out-of-range ratings and timestamps", () => {
  const warnings: string[] = [];
  const draft = normalizeDraft(
    def,
    {
      overview: "",
      categories: [
        cat("a", [
          { key: "a1", rating: 7, rationale: "", evidence: [{ start_sec: 9999, end_sec: null, observation: "", quote: null, source: "transcript" }] },
          { key: "a2", rating: 3, rationale: "", evidence: [{ start_sec: 30, end_sec: 10, observation: "", quote: null, source: "transcript" }] },
        ]),
      ],
      lesson_plan_alignment: { assessed: true, percent: 88, rationale: "", dimensions: [], objectives: [] },
      strengths: [],
      recommendations: [],
      evidence_limits: "",
    },
    600,
    false, // no planner attached
    warnings,
  );
  const a = draft.categories.find((c) => c.key === "a")!;
  assert.equal(a.criteria[0].rating, null); // 7 is outside 1..4
  assert.equal(a.criteria[0].evidence.length, 0); // 9999s is past the end of a 600s lesson
  assert.equal(a.criteria[1].evidence[0].end_sec, 30); // end before start is clamped
  assert.equal(draft.categories.length, 3); // b and c filled in
  assert.equal(draft.categories[1].criteria[0].rating, null);
  // alignment can't be assessed without a planner, whatever the model said
  assert.equal(draft.lesson_plan_alignment.assessed, false);
  assert.equal(draft.lesson_plan_alignment.percent, null);
  assert.ok(warnings.length >= 3);
  assert.equal(draft.review_notice, "draft");
});

test("unclear flagging", () => {
  const base = { start: 0, end: 5, text: "Open your books", avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.3 };
  assert.equal(isUnclear(base, 0.45), false);
  assert.equal(isUnclear({ ...base, avg_logprob: -1.2 }, 0.45), true); // exp(-1.2) ≈ 0.30
  assert.equal(isUnclear({ ...base, compression_ratio: 3 }, 0.45), true); // repetition loop
  assert.equal(isUnclear({ ...base, text: "Thank you for watching!" }, 0.45), true); // classic hallucination
});
