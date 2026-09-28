// Applies db/schema.sql and db/seed_rubrics.sql to DATABASE_URL, then checks the seeded
// rubrics against db/rubric.txt (weights per criterion and thresholds) so the database
// can't silently drift from the calibrated source.
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
} finally {
  await client.end();
}
