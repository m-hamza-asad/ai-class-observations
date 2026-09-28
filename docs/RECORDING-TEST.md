# Phone recording test (go/no-go)

Goal: decide whether teachers record **inside the web app** (live chunked upload, rolling
transcription) or **with the phone's camera app** and upload afterwards. The upload path gets built
either way as a backup. This test decides which path is the *primary* one.

Open `/lab/recorder?worker=<WORKER_URL>&token=<LAB_TOKEN>` on each phone. The worker URL and token
are remembered after the first visit.

## Devices
At minimum: **one iPhone on the newest iOS it supports, one older iPhone if the school has them, and
one mid-range Android** (the kind teachers actually carry). Note model + OS version for each.

## Test matrix (per device)

For each test: after stopping, wait for **Server check** to show results, then tap **Copy diagnostics**
and paste it to me (it's also saved on the server automatically).

| # | Where | Length | During recording | Pass if |
|---|-------|--------|------------------|---------|
| 1 | Browser tab | 2 min | nothing | plays back locally; server check "done"; durations match within ~2s |
| 2 | Browser tab | 2 min | turn **Wi-Fi off for 30s**, then on | queued chunks drain automatically; no missing chunks |
| 3 | Browser tab | 2 min | pull down Control Centre / a notification arrives | note what happens (events log) |
| 4 | Browser tab | 2 min | switch to another app for 10s, come back | note what happens (expect: recording breaks, which is useful to know) |
| 5 | **Home-screen app** (Share → Add to Home Screen, open from icon) | 2 min | nothing | same as #1; "Installed app: yes" |
| 6 | Home-screen app | **45 min**, phone on tripod, plugged in | leave it alone; **do not touch** | complete file, no stalls/gaps, phone not overheated, screen stayed on |
| 7 | Any | — | use **Fallback test: upload a camera-app video** with a 5–10 min clip recorded in the Camera app | upload completes; server check "done" |

Test 6 is the one that matters most. Run it in a real classroom if possible (real audio for later
transcription tests). Set **Max minutes** to 60.

## What I'm looking for in the diagnostics
- `counts.timerGaps`, `chunkStalls`, `trackMuted`, `unexpectedStop`: any non-zero during test 6 means the OS interrupted capture.
- `localVsWallDiffSec`: recording shorter than wall-clock time means frames were lost.
- `wakelockReleased` / `wakelock-failed`: whether the screen can be kept awake (if not, auto-lock must be disabled manually in Settings).
- `server.rollingAudioSlices`: every slice `ok` means rolling transcription works for that device's format.
- `storage.quota`: how much the phone lets us buffer offline.

## Decision rule
- **In-app recording is primary** if test 6 passes on the iPhones *and* the Android, and tests 1, 2 and 5 pass.
- **Camera app + upload is primary** if test 6 fails on any common device, or if tests 3 and 4 show interruptions that teachers will realistically trigger.
- Either way, teachers get a one-page "before you record" card: tripod, plugged in, Do Not Disturb on, auto-lock off.
