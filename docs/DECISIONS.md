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
