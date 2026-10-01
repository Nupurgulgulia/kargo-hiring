import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assessCvText } from "../src/lib/cv-quality.ts";

const sample = (name: string) => readFileSync(join(import.meta.dirname, "..", "samples", name), "utf8");

test("normal (fictional) CVs pass", () => {
  for (const f of ["strong-pm-ananya-kulkarni.txt", "weak-fit-dev-malhotra.txt"]) {
    const r = assessCvText(sample(f).repeat(1));
    assert.ok(r.ok || r.reasons.every((x) => /only \d+ words/.test(x)), `${f}: ${r.reasons.join("; ")}`);
  }
  const long = sample("strong-pm-ananya-kulkarni.txt").repeat(3);
  assert.deepEqual(assessCvText(long).reasons.filter((r) => !/repeated/.test(r)), []);
});

const BASE = sample("strong-pm-ananya-kulkarni.txt") + "\n" + sample("weak-fit-dev-malhotra.txt");

test("overlapping text layers (every letter doubled) are flagged", () => {
  const doubled = BASE.replace(/[A-Za-z]/g, (c) => c + c);
  const r = assessCvText(doubled);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /doubled letters/.test(x)), r.reasons.join("; "));
});

test("text split into single letters is flagged", () => {
  const split = BASE.replace(/([A-Za-z])/g, "$1 ");
  assert.ok(assessCvText(split).reasons.some((x) => /single letters/.test(x)));
});

test("words run together are flagged", () => {
  const glued = BASE.replace(/ (?=[A-Za-z])/g, "").replace(/\n/g, " ");
  assert.ok(assessCvText(glued).reasons.some((x) => /run together/.test(x)));
});

test("unmapped glyphs and gibberish are flagged", () => {
  const junk = BASE.replace(/[aeiou]/g, "\uE001");
  const r = assessCvText(junk);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /unmapped glyphs/.test(x)), r.reasons.join("; "));
  const consonants = "bcdfghjklmnpqrstvwxz";
  let noise = "";
  for (let i = 0; i < 4000; i++) noise += consonants[(i * 7 + (i % 5)) % consonants.length] + (i % 6 === 5 ? " " : "");
  assert.equal(assessCvText(noise).ok, false);
});

test("Word symbol-font bullets are bullets, not corruption", () => {
  const withBullets = BASE.replace(/^- /gm, "\uF0B7 ");
  assert.ok(withBullets.includes("\uF0B7"));
  assert.deepEqual(assessCvText(withBullets).reasons.filter((r) => /unmapped/.test(r)), []);
});

test("too little text is flagged", () => {
  assert.ok(assessCvText("Experience\nSkills: Excel").reasons.some((x) => /only \d+ words/.test(x)));
});
