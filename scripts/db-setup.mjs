// Applies db/schema.sql, db/seed_rubrics.sql and db/instinct.json to DATABASE_URL, then checks the
// seeded rubrics against db/rubric.txt (weights per criterion and thresholds) and the reference
// hires against rubric.txt's calibration scores, so the database can't silently drift from the
// calibrated source.
//   npm run db:setup
import { readFileSync } from "node:fs";
import pg from "pg";

// Migrations use the direct (unpooled) connection, per Neon guidance; falls back to DATABASE_URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (put it in .env.local)");

const read = (p) => readFileSync(new URL(`../db/${p}`, import.meta.url), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();

function parseRubricTxt(text) {
  const section = (start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end) : undefined);
  const weights = (s) => [...s.matchAll(/^\s*\d+\.\s+.+?—\s*Weight:\s*(\d+)%/gm)].map((m) => Number(m[1]));
  const pm = section("RUBRIC 1: PRODUCT MANAGER (PM)", "RUBRIC 2:");
  const spm = section("RUBRIC 2: SENIOR PRODUCT MANAGER (SPM)", "NOTES FOR IMPLEMENTATION");
  return {
    PM: { weights: weights(pm), threshold: Number(pm.match(/PM candidates scoring (\d+)\+/)[1]) },
    SPM: { weights: weights(spm), threshold: Number(spm.match(/SPM candidates scoring (\d+)\+/)[1]) },
  };
}

// Calibration lines look like "Lavanya Iyer     —  97  (Exceeds Expectations)", one block per rubric.
function parseCalibration(text) {
  const block = (start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  const rows = (b) =>
    Object.fromEntries(
      [...b.matchAll(/^([A-Za-z]+)[A-Za-z ]*?\s+—\s+(\d+)\s+\((Exceeds|Meets|Below) Expectations\)/gm)].map((m) => [
        m[1].toLowerCase(),
        { score: Number(m[2]), outcome: m[3].toLowerCase() },
      ]),
    );
  return {
    PM: rows(block("CALIBRATION REFERENCE SCORES (PM rubric", "Reference threshold")),
    SPM: rows(block("CALIBRATION REFERENCE SCORES (SPM rubric", "Reference threshold")),
  };
}

async function seedInstinct() {
  const data = JSON.parse(read("instinct.json"));
  const cal = parseCalibration(read("rubric.txt"));
  for (const h of data.hires) {
    const pm = cal.PM[h.slug];
    const spm = cal.SPM[h.slug];
    if (!pm || !spm) throw new Error(`${h.name}: not found in rubric.txt calibration scores`);
    if (pm.score !== h.pm_score || spm.score !== h.spm_score || pm.outcome !== h.outcome) {
      throw new Error(`${h.name} mismatch: instinct.json PM ${h.pm_score}/SPM ${h.spm_score}/${h.outcome}, rubric.txt PM ${pm.score}/SPM ${spm.score}/${pm.outcome}`);
    }
  }
  data.signals.forEach((s, i) => (s.position = i + 1));
  for (const s of data.signals) {
    await client.query(
      `insert into kargo_instinct_signals (key, position, name, strong, weaker, evidence, confidence, overlaps_rubric)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (key) do update set position=excluded.position, name=excluded.name, strong=excluded.strong,
         weaker=excluded.weaker, evidence=excluded.evidence, confidence=excluded.confidence, overlaps_rubric=excluded.overlaps_rubric`,
      [s.key, s.position, s.name, s.strong, s.weaker, s.evidence, s.confidence, s.overlaps_rubric],
    );
  }
  for (const [i, h] of data.hires.entries()) {
    await client.query(
      `insert into kargo_reference_hires (slug, position, name, outcome, pm_score, spm_score, background, standout, signals)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       on conflict (slug) do update set position=excluded.position, name=excluded.name, outcome=excluded.outcome,
         pm_score=excluded.pm_score, spm_score=excluded.spm_score, background=excluded.background,
         standout=excluded.standout, signals=excluded.signals`,
      [h.slug, i + 1, h.name, h.outcome, h.pm_score, h.spm_score, h.background, h.standout, JSON.stringify(h.signals)],
    );
  }
  // Drop anything no longer in the file, so the database mirrors it exactly.
  await client.query("delete from kargo_instinct_signals where key <> all($1)", [data.signals.map((s) => s.key)]);
  await client.query("delete from kargo_reference_hires where slug <> all($1)", [data.hires.map((h) => h.slug)]);
  const { rows: [n] } = await client.query(
    "select (select count(*)::int from kargo_instinct_signals) signals, (select count(*)::int from kargo_reference_hires) hires, (select count(*)::int from kargo_reference_hires where outcome = 'exceeds') exceeds",
  );
  console.log(`✓ instinct layer: ${n.signals} signals, ${n.hires} reference hires (${n.exceeds} exceeds); scores and outcomes match rubric.txt`);
}

try {
  await client.query(read("schema.sql"));
  console.log("✓ schema applied");
  await client.query(read("seed_rubrics.sql"));
  console.log("✓ rubrics seeded");

  const expected = parseRubricTxt(read("rubric.txt"));
  const { rows } = await client.query("select role, threshold, criteria from kargo_rubrics order by role");
  if (rows.length !== 2) throw new Error(`expected 2 rubric rows, found ${rows.length}`);
  for (const r of rows) {
    const got = r.criteria.map((c) => c.weight);
    const want = expected[r.role];
    if (JSON.stringify(got) !== JSON.stringify(want.weights) || Number(r.threshold) !== want.threshold) {
      throw new Error(`${r.role} rubric mismatch: db ${JSON.stringify(got)} @${r.threshold}, rubric.txt ${JSON.stringify(want.weights)} @${want.threshold}`);
    }
    console.log(`✓ ${r.role}: weights ${got.join("/")} (sum ${got.reduce((a, b) => a + b, 0)}), threshold ${r.threshold} match rubric.txt`);
  }
  await seedInstinct();
} finally {
  await client.end();
}
