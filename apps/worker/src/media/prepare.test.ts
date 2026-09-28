import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFMPEG, run } from "./ffmpeg.js";
import { repairFragmentedMp4 } from "./fmp4.js";
import { prepareVideo, validateOutput } from "./prepare.js";

/** A 6-second fragmented H.264/AAC MP4 with variable frame timing, like browser MediaRecorder output. */
async function makeFragmentedClip(dir: string) {
  const file = path.join(dir, "clip.mp4");
  const r = await run(FFMPEG, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "6",
    // jitter frame times so the muxer writes a duration per sample (as Safari does)
    "-vf", "setpts=PTS+0.004*mod(N\\,3)/TB", "-fps_mode", "vfr",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30",
    "-c:a", "aac",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    file,
  ]);
  assert.equal(r.code, 0, r.stderr);
  return file;
}

/**
 * Overwrite one per-sample video duration with a wrapped negative value, as iOS did after an
 * interruption. (ffmpeg only writes per-sample durations where frame timing varies, so we target
 * the first video run that has them.)
 */
async function corruptLikeSafari(file: string) {
  const buf = await readFile(file);
  for (let traf = buf.indexOf("traf"); traf > 0; traf = buf.indexOf("traf", traf + 4)) {
    const trackId = buf.readUInt32BE(buf.indexOf("tfhd", traf) + 8);
    const trun = buf.indexOf("trun", traf);
    const flags = buf.readUInt32BE(trun + 4) & 0xffffff;
    if (trackId !== 1 || !(flags & 0x100)) continue; // track 1 = video in ffmpeg's output
    // point at the 6th sample's duration so the bad one sits mid-fragment, like the iPhone file
    const perSample = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
    const p = trun + 12 + (flags & 0x1 ? 4 : 0) + (flags & 0x4 ? 4 : 0) + perSample * 5;
    const fh = await open(file, "r+");
    const bad = Buffer.alloc(4);
    bad.writeUInt32BE(0xffffff00, 0); // -256 as int32
    await fh.write(bad, 0, 4, p);
    await fh.close();
    return;
  }
  throw new Error("fixture has no video run with per-sample durations");
}

test("repairs a wrapped negative sample duration and the file then remuxes cleanly", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prep-"));
  try {
    const clip = await makeFragmentedClip(dir);
    await corruptLikeSafari(clip);

    const out = path.join(dir, "out.mp4");
    const result = await prepareVideo(clip, out);
    assert.equal(result.repairs.length, 1);
    assert.equal(result.repairs[0].track, "video");
    assert.ok(result.repairs[0].badDurationSec > 1000);
    assert.equal(result.method, "remux");
    assert.ok(Math.abs((result.output.durationSec ?? 0) - 6) < 0.5, `duration ${result.output.durationSec}`);
    assert.equal(validateOutput(result.output), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an undamaged file is left untouched", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prep-"));
  try {
    const clip = await makeFragmentedClip(dir);
    const before = await readFile(clip);
    const r = await repairFragmentedMp4(clip);
    assert.equal(r.fragmented, true);
    assert.equal(r.repairs.length, 0);
    assert.ok(before.equals(await readFile(clip)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateOutput rejects impossible durations", () => {
  const base = { ok: true, formatName: "mp4", video: { codec: "h264", width: 1280, height: 720 } };
  assert.match(validateOutput({ ...base, durationSec: 7158336 }) ?? "", /longer than any possible recording/);
  assert.match(validateOutput({ ...base, durationSec: 600, video: { ...base.video, durationSec: 600 }, audio: { codec: "aac", sampleRate: 48000, channels: 2, durationSec: 300 } }) ?? "", /disagree/);
  assert.equal(validateOutput({ ...base, durationSec: 60 }), null);
});
