/**
 * Repair of fragmented-MP4 timing written by browser MediaRecorder.
 *
 * Found in real iPhone tests (iOS 18.7): when capture is interrupted (e.g. a timer alert takes the
 * audio session), Safari can write a *negative* duration for one sample. Stored as an unsigned 32-bit
 * number it wraps to ~4.29e9 ticks (7,158,278 s at a 600 Hz timescale), so the file claims to be
 * months long and ffmpeg can't mux it. Each fragment also carries its absolute start time (tfdt), so
 * the correct duration can be recovered from the next fragment's start.
 *
 * Works on the file in place, reading only box headers and the small moof boxes, so it's cheap even
 * for a 45-minute recording. Only the 4-byte sample-duration fields that are wrong are rewritten.
 */
import { open, type FileHandle } from "node:fs/promises";

export interface TimingRepair {
  track: "video" | "audio" | "other";
  fragment: number;
  samplesFixed: number;
  /** where in the recording the bad sample was (seconds) */
  atSec: number;
  badDurationSec: number;
  fixedDurationSec: number;
}

export interface RepairResult {
  fragmented: boolean;
  fragments: number;
  repairs: TimingRepair[];
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "edts"]);
/** A single sample longer than this is treated as corrupt (a real freeze is seconds, not minutes). */
const MAX_SANE_SAMPLE_SEC = 600;

interface Sample {
  duration: number;
  /** absolute file offset of this sample's duration field, or null when it comes from a default */
  offset: number | null;
}

interface TrackFragment {
  fragment: number;
  tfdt: number;
  samples: Sample[];
}

interface BoxHeader {
  type: string;
  start: number;
  size: number;
  headerSize: number;
}

async function readHeader(fh: FileHandle, at: number, fileSize: number): Promise<BoxHeader | null> {
  if (at + 8 > fileSize) return null;
  const buf = Buffer.alloc(16);
  await fh.read(buf, 0, 16, at);
  let size = buf.readUInt32BE(0);
  const type = buf.toString("latin1", 4, 8);
  let headerSize = 8;
  if (size === 1) {
    size = Number(buf.readBigUInt64BE(8));
    headerSize = 16;
  } else if (size === 0) {
    size = fileSize - at;
  }
  if (size < headerSize) return null;
  return { type, start: at, size, headerSize };
}

function* children(buf: Buffer, start: number, end: number): Generator<{ type: string; body: number; end: number }> {
  let o = start;
  while (o + 8 <= end) {
    let size = buf.readUInt32BE(o);
    let hdr = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(o + 8));
      hdr = 16;
    }
    if (size === 0) size = end - o;
    if (size < hdr || o + size > end) return;
    yield { type: buf.toString("latin1", o + 4, o + 8), body: o + hdr, end: o + size };
    o += size;
  }
}

export async function repairFragmentedMp4(file: string): Promise<RepairResult> {
  const fh = await open(file, "r+");
  try {
    const fileSize = (await fh.stat()).size;
    const timescale = new Map<number, number>();
    const kind = new Map<number, string>();
    const trexDuration = new Map<number, number>();
    const byTrack = new Map<number, TrackFragment[]>();
    let fragments = 0;

    for (let at = 0; ; ) {
      const h = await readHeader(fh, at, fileSize);
      if (!h) break;
      if (h.type === "moov" || h.type === "moof") {
        const buf = Buffer.alloc(h.size);
        await fh.read(buf, 0, h.size, h.start);
        if (h.type === "moov") parseMoov(buf, h.headerSize, h.size, timescale, kind, trexDuration);
        else parseMoof(buf, h.start, h.headerSize, ++fragments, trexDuration, byTrack);
      }
      at = h.start + h.size;
    }

    const repairs: TimingRepair[] = [];
    if (!fragments) return { fragmented: false, fragments: 0, repairs };

    for (const [trackId, frags] of byTrack) {
      const ts = timescale.get(trackId);
      if (!ts) continue;
      const maxTicks = MAX_SANE_SAMPLE_SEC * ts;
      frags.sort((a, b) => a.tfdt - b.tfdt);
      for (let i = 0; i < frags.length; i++) {
        const f = frags[i];
        const bad = f.samples.filter((s) => s.offset !== null && s.duration > maxTicks);
        if (!bad.length) continue;
        const good = f.samples.filter((s) => !bad.includes(s));
        const goodTicks = good.reduce((a, s) => a + s.duration, 0);
        const typical = median(good.map((s) => s.duration)) || 1;
        const next = frags[i + 1];
        // the fragment must end where the next one starts; otherwise assume typical sample durations
        const target = next ? next.tfdt - f.tfdt : goodTicks + typical * bad.length;
        const each = Math.max(1, Math.round((target - goodTicks) / bad.length));
        for (const s of bad) {
          const b = Buffer.alloc(4);
          b.writeUInt32BE(each >>> 0, 0);
          await fh.write(b, 0, 4, s.offset!);
        }
        let t = f.tfdt;
        for (const s of f.samples) {
          if (s === bad[0]) break;
          t += s.duration;
        }
        const k = kind.get(trackId);
        repairs.push({
          track: k === "vide" ? "video" : k === "soun" ? "audio" : "other",
          fragment: f.fragment,
          samplesFixed: bad.length,
          atSec: round3(t / ts),
          badDurationSec: round3(bad[0].duration / ts),
          fixedDurationSec: round3(each / ts),
        });
      }
    }
    return { fragmented: true, fragments, repairs };
  } finally {
    await fh.close();
  }
}

function parseMoov(buf: Buffer, start: number, end: number, timescale: Map<number, number>, kind: Map<number, string>, trexDuration: Map<number, number>, track: { id: number } = { id: 0 }) {
  for (const bx of children(buf, start, end)) {
    if (bx.type === "trak") {
      parseMoov(buf, bx.body, bx.end, timescale, kind, trexDuration, { id: 0 });
      continue;
    }
    if (bx.type === "tkhd") track.id = buf.readUInt32BE(bx.body + (buf[bx.body] === 1 ? 20 : 12));
    if (bx.type === "mdhd") timescale.set(track.id, buf.readUInt32BE(bx.body + (buf[bx.body] === 1 ? 20 : 12)));
    if (bx.type === "hdlr") kind.set(track.id, buf.toString("latin1", bx.body + 8, bx.body + 12));
    if (bx.type === "trex") trexDuration.set(buf.readUInt32BE(bx.body + 4), buf.readUInt32BE(bx.body + 12));
    if (CONTAINERS.has(bx.type)) parseMoov(buf, bx.body, bx.end, timescale, kind, trexDuration, track);
  }
}

function parseMoof(buf: Buffer, fileOffset: number, start: number, fragment: number, trexDuration: Map<number, number>, byTrack: Map<number, TrackFragment[]>) {
  for (const traf of children(buf, start, buf.length)) {
    if (traf.type !== "traf") continue;
    let trackId = 0;
    let defaultDuration: number | undefined;
    let tfdt = 0;
    const samples: Sample[] = [];
    for (const bx of children(buf, traf.body, traf.end)) {
      const flags = buf.readUInt32BE(bx.body) & 0xffffff;
      if (bx.type === "tfhd") {
        trackId = buf.readUInt32BE(bx.body + 4);
        let p = bx.body + 8;
        if (flags & 0x1) p += 8; // base_data_offset
        if (flags & 0x2) p += 4; // sample_description_index
        if (flags & 0x8) defaultDuration = buf.readUInt32BE(p);
      } else if (bx.type === "tfdt") {
        tfdt = buf[bx.body] === 1 ? Number(buf.readBigUInt64BE(bx.body + 4)) : buf.readUInt32BE(bx.body + 4);
      } else if (bx.type === "trun") {
        const count = buf.readUInt32BE(bx.body + 4);
        let p = bx.body + 8;
        if (flags & 0x1) p += 4; // data_offset
        if (flags & 0x4) p += 4; // first_sample_flags
        for (let i = 0; i < count; i++) {
          let duration = defaultDuration ?? trexDuration.get(trackId) ?? 0;
          let offset: number | null = null;
          if (flags & 0x100) {
            duration = buf.readUInt32BE(p);
            offset = fileOffset + p;
            p += 4;
          }
          if (flags & 0x200) p += 4;
          if (flags & 0x400) p += 4;
          if (flags & 0x800) p += 4;
          samples.push({ duration, offset });
        }
      }
    }
    if (!byTrack.has(trackId)) byTrack.set(trackId, []);
    byTrack.get(trackId)!.push({ fragment, tfdt, samples });
  }
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
