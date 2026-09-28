# Decisions log

## 2026-09-28: Answers to the kickoff questions

| Topic | Decision | Consequence for the build |
|---|---|---|
| Transcript script | **Roman Urdu** for now. Urdu script is deferred to Urdu-only classes. | Whisper doesn't reliably emit Roman Urdu (it tends toward Devanagari or Urdu script). Pipeline: Whisper `verbose_json` (per-segment timing and log-probs) → **romanization pass per segment** (small, cheap LLM call; timestamps untouched) → store both original and romanized text. Confidence comes from Whisper, not the romanizer. |
| Baseline for "better transcript" | School has no archived AI Studio output. | We **recreate the baseline**: run the same test lesson through the current method (Gemini with a plain "transcribe this" prompt) and show it side by side with ours. Best if a bilingual staff member also hand-corrects ~5 min so both can be scored. |
| Supporting documents | KPIs/TORs/learning outcomes → class rubric. Lesson planner → attached per recording. | `documents.scope` = `class` or `recording`; rubric derived only from class-scoped docs. |
| Devices | iPhones, Androids, others. | In-app recorder must handle MP4 (Safari/Chrome) and WebM (Chrome/Firefox). The server normalizes everything to H.264/AAC MP4. |
| Camera placement | Tripod, **facing the teacher**. | Gemini prompt focuses on what's visible: teacher delivery, board use, movement, gestures, questioning. Student attentiveness is mostly *not* visible, so it's inferred from audio (responses, noise, disruptions) and marked **"limited evidence"** rather than guessed. A second (student-facing) angle can be added later. |
| Teacher accounts | Admin invites by **magic link** email. | Supabase `inviteUserByEmail` from the admin screen; requires custom SMTP (see SETUP.md §4). |
| Video expiry | **Admin** sets it. | `academic_terms` table (campus_id, name, ends_on). Admin manages terms; each recording inherits the current term's end date as `semester_expiry_date`, and the admin can override it per recording. |
| Report template | I design it; it can be changed later. | Versioned template stored in the DB (not hard-coded) so edits don't need a deploy. |

## 2026-09-28: Technical findings from the lab build

- **Uploads bypass the Next.js layer.** Next's proxy caps request bodies at 10 MB (Vercel functions allow even less). Browsers upload chunks directly to the worker (CORS-restricted, authenticated with the user's Supabase JWT). Whole-file uploads (fallback path) go straight to Supabase Storage via resumable (TUS) upload.
- **Rolling transcription on growing files works.** MediaRecorder chunks aren't independently playable, so the worker appends them in order to one growing file and cuts audio slices on *media time* (browsers emit chunks at uneven rates: Chrome MP4 gave 24 chunks for 78s at a 2s timeslice). Verified with MP4 and WebM, out-of-order and duplicate delivery, and a simulated network outage.
- **Normalization is fast:** 0.05–0.11× real time (a 40-min lesson ≈ 2–5 min of CPU), well inside the 10-minute budget. Railway's shared CPUs will be slower; measure it in the phone test.
- **Queue:** pg-boss on Supabase Postgres (no Redis). **Backend host:** Railway (Docker + persistent volume).

## 2026-09-28: Day 2 (schema, auth, admin setup)

- **`profiles` instead of `users`.** The brief's `users` table is `public.profiles`, one row per Supabase auth user. That avoids confusion with Supabase's own `auth.users`.
- **Roles can't be self-granted.** Profiles are only created by the admin invite flow (service role). Public sign-up is off, and magic-link sign-in never creates accounts (`shouldCreateUser: false`). Verified by `npm run check-rls`.
- **Campus scoping is in the database.** Every access rule scopes admins to their own `campus_id`, so going multi-campus needs no rewrite of the rules. Teachers only ever see their own classes, recordings and *final* reports (and those reports' transcripts).
- **Pipeline writes bypass RLS** through the worker's service-role key. Browsers can read and create only what their policies allow; status fields (recording status, reports, job rows) are worker-owned.
- **Documents are never hard-deleted.** "Remove" marks them superseded, so any report stays traceable to the exact documents behind it. Rubric derivation will use only current, successfully parsed, class-scoped documents.
- **Job tracking.** pg-boss (in its own `pgboss` schema on the Supabase database) runs the jobs. `processing_jobs` is the user-visible mirror (attempt count, error detail). Failures a retry can't fix (unsupported file, no text layer) fail immediately instead of retrying. On startup the worker re-queues any document left `pending`, so a dropped request can't strand one.
- **Service key in Vercel (server-only).** Admin invites need `auth.admin`, so the Next.js server holds `SUPABASE_SERVICE_ROLE_KEY` as a non-public env var, used only in server actions after an admin check.
- **Email links use `token_hash` + server-side verification.** Tested: a link requested in one browser redeems from a completely separate client, so a teacher can request on a laptop and open on their phone.
- **Report template v1** is seeded as data (`report_templates`): overview, per-rubric-category ratings (1–4 plus "not enough evidence") with timestamped evidence, plan alignment, language of instruction, strengths, recommendations, and evidence limitations.
- **Known gap: scanned PDFs** (images, no text layer) are rejected with a clear message. OCR can be added later (e.g. Gemini) if schools' documents turn out to be scans.

## 2026-09-28: Day 3 (fixed framework, report generation, live recording)

**Correction from the school's documents:** the rubric is the school's fixed five-category framework, not derived per class.
- Per-class rubric derivation was removed (the `rubrics` table was dropped). The framework is **report template v2** (`school-observation-framework`), global and versioned. Reports pin the template version they were scored with. Admins can see it at *Admin → Framework*.
- Class documents (KPIs, TORs, learning outcomes) are **context** for the narrative. The teacher's lesson planner (attached per recording) drives the separate **lesson-plan alignment %**, using the school's own prompt verbatim.
- **Scores are computed in code, not by the model.** Claude rates each criterion 1–4 or "not observed" with timestamped evidence. Category % = mean observed rating ÷ 4. Overall framework % = weighted mean of categories that have evidence. "Not observed" is excluded, never scored as 0, and listed in the report. The alignment % is the one number the model judges directly, because the school's prompt asks for it.
- **Draft framing.** Because scores will feed hiring (<50% ineligible) and staff thresholds (70% meets standard), the report, the prompt and the UI all present output as an *AI draft for administrator review*. The prompt forbids pass/fail, eligibility or threshold language. No threshold is shown or applied anywhere in the app.
- **Live chunked upload is the default** (confirmed). The recorder shows upload state at all times, with a prominent red banner when offline, and the pre-flight checklist explicitly tells teachers *not* to use Airplane Mode.

**Pipeline** (all stages are pg-boss jobs mirrored in `processing_jobs`; the stage-uniqueness index makes triggers idempotent):
upload → rolling transcription (60s slices with 2s overlap, Whisper large-v3, confidence from log-probs, Urdu/Devanagari script romanized by Claude, original kept) → normalization (H.264 720p, stored in Supabase Storage) → transcript assembly (failed slices become visible gaps; >20% failed fails the stage) → draft report (Claude, structured output, validated and normalized in code) → recording `ready`.
- **Models:** `claude-sonnet-5` for the report (the brief specifies Sonnet) and, by default, for romanization. Both are configurable (`CLAUDE_REPORT_MODEL`, `CLAUDE_ROMANIZE_MODEL`).
- **`AI_FAKE=1`** (local only, refused in production) replaces AI calls with labelled fake output, so the pipeline can be tested without keys.
- Video analysis (Gemini) is not built yet. The report runs on the transcript and states the limitation.
- `human_observer_reports` is added as a placeholder table only (no logic or UI).

**Open questions for the school** (current defaults are in brackets and easy to change in the template):
1. Rating scale and score conversion. [1–4 per criterion; % = mean ÷ 4, so "Developing" = 50% and "Proficient" = 75%]. The 50%/70% thresholds depend on this mapping.
2. Which score the thresholds apply to: framework %, alignment %, or a combination? [kept separate; no combined score]
3. Category weights. [equal]
4. Exact definitions of *flipped learning*, *closed-book introduction* and *focused grid*. [working descriptors, marked "to confirm"]
