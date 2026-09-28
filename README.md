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
Day 1: the recording lab (`/lab/recorder`) plus worker lab endpoints are built and verified locally
(MP4 and WebM, offline retry, rolling audio slices, normalization, Docker image). **Waiting on the
real-device test** before building the production recorder.
