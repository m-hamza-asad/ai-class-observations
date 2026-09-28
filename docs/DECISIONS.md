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
