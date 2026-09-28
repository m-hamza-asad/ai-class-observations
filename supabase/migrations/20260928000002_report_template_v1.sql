-- Observation report template v1. The report generator (Claude) fills these sections; the
-- "rubric_categories" section expands into one block per category of the class's rubric.
-- Change the template by inserting a new version and flipping is_active, not by editing this row,
-- so older reports stay tied to the template they were generated with.
insert into public.report_templates (name, version, is_active, definition) values (
  'standard-observation', 1, true,
  $json$
  {
    "rating_scale": [
      { "value": 1, "label": "Beginning",  "description": "Expected practice is largely absent or ineffective." },
      { "value": 2, "label": "Developing", "description": "Practice is present but inconsistent or only partly effective." },
      { "value": 3, "label": "Proficient", "description": "Practice is consistently present and effective." },
      { "value": 4, "label": "Exemplary",  "description": "Practice is highly effective and could serve as a model for colleagues." }
    ],
    "insufficient_evidence_label": "Not enough evidence",
    "evidence_strength_levels": ["strong", "moderate", "limited"],
    "sections": [
      {
        "key": "overview",
        "title": "Lesson overview",
        "kind": "narrative",
        "guidance": "3-5 sentences: topic, structure of the lesson (phases with approximate timestamps), and overall impression. Neutral, professional tone."
      },
      {
        "key": "rubric",
        "title": "Evaluation against rubric",
        "kind": "rubric_categories",
        "per_category": {
          "rating": "Integer from rating_scale, or null with the insufficient-evidence label when the recording does not show enough to judge.",
          "evidence_strength": "How directly the transcript/video supports the rating.",
          "evidence": "2-4 specific observations, each with a [mm:ss] timestamp and, where useful, a short quote (Roman Urdu kept as spoken, with an English gloss).",
          "strengths": "1-2 sentences.",
          "growth_areas": "1-2 sentences, concrete and actionable."
        }
      },
      {
        "key": "plan_alignment",
        "title": "Alignment with lesson plan and learning outcomes",
        "kind": "narrative",
        "guidance": "Compare what was planned (if a lesson planner was attached) and the class learning outcomes with what happened. State clearly if no planner was attached."
      },
      {
        "key": "language_use",
        "title": "Language of instruction",
        "kind": "narrative",
        "guidance": "How English and Urdu were used: approximate balance, whether code-switching supported understanding (e.g. explaining concepts, checking comprehension) or replaced target-language practice. Descriptive, not judgemental unless the rubric sets a language expectation."
      },
      {
        "key": "strengths",
        "title": "Key strengths",
        "kind": "bullets",
        "guidance": "3 bullets, each tied to a timestamp."
      },
      {
        "key": "recommendations",
        "title": "Recommendations",
        "kind": "bullets",
        "guidance": "3 prioritised, specific next steps the teacher could try in the next lesson, each linked to a rubric category."
      },
      {
        "key": "evidence_limits",
        "title": "Evidence limitations",
        "kind": "narrative",
        "guidance": "What the recording could not show: the camera faces the teacher, so student engagement is inferred mainly from audio; note the share of transcript flagged unclear and any gaps in the recording. Keeps the report honest about its confidence."
      }
    ]
  }
  $json$::jsonb
);
