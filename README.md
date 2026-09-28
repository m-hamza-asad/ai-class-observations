# Lesson Observation (POC)

Automated classroom observation: teachers record a lesson on their phone, the system transcribes
it (English/Urdu code-switching, Roman Urdu output), analyzes the video, and drafts a structured
observation report against the class's rubric. Admins then review, edit and finalize it.

```
apps/web      Next.js 16 PWA (teacher + admin UI)          → Vercel
apps/worker   Node/TS service: ingest, ffmpeg, AI pipeline → Railway (Docker)
packages/     shared types (from Day 2)
docs/         decisions log, recording test protocol
```

- Accounts and keys: [SETUP.md](SETUP.md)
- Phone recording go/no-go test: [docs/RECORDING-TEST.md](docs/RECORDING-TEST.md)
- Decisions and findings: [docs/DECISIONS.md](docs/DECISIONS.md)

## Status
- **Day 1:** recording lab (`/lab/recorder`) and worker lab endpoints. Verified locally; **waiting on the real-device test**.
- **Day 2:** Supabase schema + access rules, magic-link auth with admin/teacher roles, admin setup (people, classes,
  documents with PDF/DOCX text extraction, terms), job queue with retries and failure reporting. Verified locally
  end to end, including `npm run check-rls` (20 access checks).
- **Day 3:** the school's fixed five-category framework (template v2) plus a separate lesson-plan alignment %. Teacher
  recording screen with live chunked upload and always-visible upload/offline state. Worker pipeline: rolling Whisper
  transcription with romanization and unclear flags, normalization to Storage, and a Claude draft report with
  scores computed in code. Admin recordings list and review view (video, transcript, draft, clickable timestamps).
  Verified end to end locally with `AI_FAKE=1`; **real AI calls need the Groq and Anthropic keys.**
