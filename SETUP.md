# Setup checklist

Everything the POC needs, in the order you'll need it. Nothing here is required for the
**local** recording lab; you need items 1–2 (or a tunnel) to test on phones, and 3–7 from Day 2.

> **Use paid tiers for any real classroom footage.** Recordings contain minors. Free API tiers
> (notably Gemini's) may use submitted content to improve the provider's models. Paid tiers do not.

| # | Account | Plan for the POC | Needed from |
|---|---------|------------------|-------------|
| 1 | Vercel (frontend) | Hobby for internal testing; **Pro** before any commercial use (Hobby is non-commercial only) | Phone testing |
| 2 | Railway (worker) | Hobby ($5/mo usage-based) | Phone testing |
| 3 | Supabase (DB, auth, storage) | **Pro ($25/mo)**: the free plan caps files at 50 MB; a 40-min lesson is 300 MB+ | Day 2 |
| 4 | Email sender for magic links (e.g. Resend) | Free tier | Day 2 |
| 5 | Groq (Whisper large-v3) | Paid / Developer tier (higher file-size and rate limits) | Day 4 |
| 6 | Google AI Studio (Gemini) | **Billing enabled** (paid tier: data not used for training) | Day 4 |
| 7 | Anthropic (Claude) | Pay-as-you-go credits | Day 3 |

---

## 1. Vercel
1. Sign up at https://vercel.com (a GitHub login is easiest).
2. You'll import this repo later, with **Root Directory = `apps/web`**. I can do the import with the Vercel CLI once you're logged in.
3. Environment variables (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_WORKER_URL`: the Railway URL from step 2
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`: **not** prefixed with `NEXT_PUBLIC_`, so it stays on the server. The admin screens need it to send invites.

## 2. Railway
1. Sign up at https://railway.com and choose the Hobby plan.
2. New Project → Deploy from GitHub repo (or `railway up` from the CLI). `railway.json` at the repo root already points at `apps/worker/Dockerfile`.
3. Add a **Volume** mounted at `/data` (chunk staging survives restarts).
4. Settings → Networking → **Generate Domain**. This URL is `NEXT_PUBLIC_WORKER_URL`.
5. Variables: `LAB_TOKEN` (any long random string), `CORS_ORIGINS` (your Vercel URL). The rest are listed in `apps/worker/.env.example`.

## 3. Supabase
1. Sign up at https://supabase.com and create a project. **Region:** pick the one closest to the school (e.g. Mumbai `ap-south-1` for Pakistan).
2. Upgrade to **Pro**, then Storage → Settings → set the global file size limit to 5 GB.
3. Project Settings → API keys: copy
   - Project URL → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` / **publishable** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe for the browser)
   - `service_role` / **secret** key → `SUPABASE_SERVICE_ROLE_KEY` (worker + Vercel server env; **never** in a `NEXT_PUBLIC_` variable)
4. Click **Connect** (top bar) → **Session pooler** connection string → `DATABASE_URL` (worker job queue).
5. Authentication → URL Configuration: set Site URL to the Vercel URL, and add `http://localhost:3000/**` to redirect URLs.
6. Authentication → Sign In / Providers → **turn off "Allow new users to sign up"** (accounts are created only by admin invite).
7. Authentication → Emails → Templates: paste `supabase/templates/invite.html` into **Invite user** and
   `supabase/templates/magic_link.html` into **Magic Link**. (These links are verified server-side, so they work
   even when the email is opened on a different device from the one that asked for it.)
8. Apply the database schema from your machine:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
9. Create the campus and the first admin (sends them an invite email):
   ```bash
   SUPABASE_URL=<project url> SUPABASE_SERVICE_ROLE_KEY=<secret key> npm run bootstrap-admin -- you@school.edu.pk "Your Name" "Campus Name"
   ```

## 4. Email for magic links
Supabase's built-in email sender only delivers to your own project team's addresses and is heavily
rate-limited, so teacher invites **will not arrive** without a custom SMTP sender.
1. Sign up at https://resend.com (free tier), verify a sending domain (or use their test domain for the demo).
2. Supabase → Authentication → Emails → SMTP Settings → enter Resend's SMTP host, user and API key.

## 5. Groq
1. Sign up at https://console.groq.com and upgrade to the paid/Developer tier.
2. API Keys → Create → `GROQ_API_KEY` (worker).

## 6. Google AI Studio (Gemini)
1. Go to https://aistudio.google.com → **Get API key** → create a key in a new Google Cloud project.
2. **Set up billing** on that project (AI Studio → Billing). Without billing you're on the free tier (data may be used for training, low rate limits).
3. → `GEMINI_API_KEY` (worker).

## 7. Anthropic
1. Sign up at https://platform.claude.com (formerly console.anthropic.com), add credits under Billing.
2. API Keys → Create → `ANTHROPIC_API_KEY` (worker).

---

## Where each key lives

| Variable | Vercel (web) | Railway (worker) |
|---|---|---|
| `NEXT_PUBLIC_WORKER_URL` | ✓ | |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ (server only) | ✓ |
| `SUPABASE_URL`, `DATABASE_URL` | | ✓ |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | | ✓ |
| `LAB_TOKEN`, `CORS_ORIGINS`, `DATA_DIR=/data` | | ✓ |

All AI keys stay on the worker. The browser only ever holds the Supabase public key and the user's session.

## Worker AI settings
| Variable | Default | Notes |
|---|---|---|
| `GROQ_API_KEY` | (none) | Whisper large-v3 transcription |
| `ANTHROPIC_API_KEY` | (none) | Romanization + draft report |
| `CLAUDE_REPORT_MODEL` / `CLAUDE_ROMANIZE_MODEL` | `claude-sonnet-5` | Change without a code change |
| `GEMINI_API_KEY` | (none) | Video analysis (next build step) |
| `UNCLEAR_CONFIDENCE_THRESHOLD` | `0.45` | Transcript lines below this are flagged "unclear"; tune on real lessons |
| `AI_FAKE` | `0` | `1` = fake AI output for **local** pipeline testing; refused when `NODE_ENV=production` |

Missing keys don't crash anything: the affected stage fails with a clear "not configured" message on the recording page.

## Local development
Needs Docker Desktop running (for the local Supabase stack).
```bash
npm install
npx supabase start          # local Postgres/Auth/Storage + Mailpit inbox at http://127.0.0.1:54324
npm run dev:worker          # http://localhost:4000
npm run dev:web             # http://localhost:3000
npm run bootstrap-admin -- you@example.com "Your Name"   # then open the invite in Mailpit
```
Copy `apps/worker/.env.example` → `apps/worker/.env` and `apps/web/.env.example` → `apps/web/.env.local`, filling in
the values printed by `npx supabase start`. Locally, no email really goes out: every invite and sign-in link lands in Mailpit.

Checks:
```bash
npm run check-rls           # access-rule checks against local Supabase (creates and cleans up test users)
npm test -w worker          # unit tests
```
After changing the schema, add a migration in `supabase/migrations/` and regenerate types with `npm run gen:types -w @obs/shared`.
