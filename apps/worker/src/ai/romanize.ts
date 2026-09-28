/**
 * Whisper often writes Urdu speech in Urdu (Arabic) or Hindi (Devanagari) script. The school wants
 * Roman Urdu, so segments containing those scripts are transliterated (never translated) by Claude.
 * Timestamps are untouched; the original text is kept alongside for audit.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiFake, config } from "../config.js";
import { assertUsableResponse, claude, textOf, toStageError } from "./claude.js";

export const ROMANIZE_PROMPT_VERSION = "romanize-v1";

const NON_LATIN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿ऀ-ॿ]/;
export const needsRomanization = (text: string) => NON_LATIN.test(text);

const SYSTEM = `You transliterate classroom speech transcripts from Pakistan into Roman Urdu.

Input: JSON list of transcript lines. Some are in Urdu script or Devanagari (Hindi script), often mixed with English words.
Output: the same lines, each rewritten in Roman Urdu as Pakistanis commonly type it (e.g. "Aaj hum chapter five parhenge, samajh aaya?").

Rules:
- Transliterate, never translate. The meaning and every word must stay exactly as spoken; do not add, drop, summarise or correct anything.
- English words stay in English spelling.
- Keep the same "i" for every line and return every line, in order.`;

const OutputSchema = z.object({
  lines: z.array(z.object({ i: z.number().int(), roman: z.string() })),
});

export interface RomanizeResult {
  romanized: Map<number, string>;
  model: string;
  provider: "anthropic" | "fake";
  usage: unknown;
  latencyMs: number;
}

export async function romanize(lines: { i: number; text: string }[]): Promise<RomanizeResult> {
  if (!lines.length) return { romanized: new Map(), model: "none", provider: "fake", usage: null, latencyMs: 0 };
  if (aiFake) {
    return { romanized: new Map(lines.map((l) => [l.i, `[fake-roman] ${l.text.replace(new RegExp(NON_LATIN.source, "g"), "").replace(/\s+/g, " ").trim() || "aaj hum parhenge"}`])), model: "fake-claude", provider: "fake", usage: null, latencyMs: 1 };
  }

  const started = Date.now();
  try {
    const msg = await claude().messages.create({
      model: config.CLAUDE_ROMANIZE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(lines) }],
      // mechanical task: low effort keeps it fast and cheap
      output_config: { format: zodOutputFormat(OutputSchema), effort: "low" },
    });
    assertUsableResponse(msg);
    const parsed = OutputSchema.parse(JSON.parse(textOf(msg)));
    const romanized = new Map(parsed.lines.filter((l) => lines.some((x) => x.i === l.i)).map((l) => [l.i, l.roman.trim()]));
    return { romanized, model: config.CLAUDE_ROMANIZE_MODEL, provider: "anthropic", usage: msg.usage, latencyMs: Date.now() - started };
  } catch (err) {
    throw toStageError(err);
  }
}
