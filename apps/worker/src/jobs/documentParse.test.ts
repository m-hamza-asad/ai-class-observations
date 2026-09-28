import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractText } from "./documentParse.js";
import { PermanentError } from "./tracking.js";

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url));

test("extracts text from DOCX", async () => {
  const text = await extractText(fixture("kpis.docx"), "KPIs 2026.DOCX");
  assert.match(text, /Teacher Key Performance Indicators/);
  assert.match(text, /medium of instruction/);
});

test("extracts text from a text-based PDF", async () => {
  const text = await extractText(fixture("tors.pdf"), "tors.pdf");
  assert.match(text, /Terms of Reference/);
  assert.match(text, /timely feedback/);
});

test("rejects unsupported formats without retrying", async () => {
  await assert.rejects(extractText(Buffer.from("x"), "old.doc"), PermanentError);
});

test("rejects documents with no readable text (e.g. scanned PDFs)", async () => {
  await assert.rejects(extractText(Buffer.from("   \n  "), "empty.txt"), PermanentError);
});
