import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoPII, detectContact, guessName, redact } from "../src/lib/pii.ts";
import { computeRubricScore, recommendationFor, tierFor } from "../src/lib/scoring.ts";
import type { Rubric } from "../src/lib/types.ts";

const CV = `PRIYA RAMANATHAN
Mumbai, India | priya.ramanathan@gmail.com | +91 98200 12345 | linkedin.com/in/priya-ramanathan

EXPERIENCE
Operations Executive, Allcargo Logistics (Jan 2018 – Mar 2021)
- Identified that shipment exceptions were tracked on paper; built a Google Sheets tracker no one asked for, adopted by 3 branch teams.
- Resolved a customs hold at JNPT within 3 hours without escalating.
Priya also led 2019-2021 carrier onboarding.`;

test("detects name, email and phone", () => {
  const c = detectContact(CV);
  assert.equal(c.full_name, "Priya Ramanathan");
  assert.equal(c.email, "priya.ramanathan@gmail.com");
  assert.equal(c.phone, "+91 98200 12345");
});

test("redaction strips PII but keeps dates and content", () => {
  const c = detectContact(CV);
  const r = redact(CV, c);
  assert.ok(!/priya/i.test(r), "name removed, including standalone first name");
  assert.ok(!/ramanathan/i.test(r));
  assert.ok(!r.includes("98200"), "phone removed");
  assert.ok(!r.includes("@"), "email removed");
  assert.ok(!/linkedin/i.test(r), "profile URL removed");
  assert.ok(r.includes("Jan 2018 – Mar 2021"), "date range kept");
  assert.ok(r.includes("2019-2021"), "year range kept");
  assert.ok(r.includes("adopted by 3 branch teams"));
  assert.doesNotThrow(() => assertNoPII(r, c));
});

test("PII guard blocks leaked values", () => {
  const c = detectContact(CV);
  assert.throws(() => assertNoPII("contact priya.ramanathan@gmail.com", c), /email/);
  assert.throws(() => assertNoPII("call 98200 12345", c), /phone/);
  assert.throws(() => assertNoPII("Ramanathan led the team", c), /name/);
});

test("name guess skips headers", () => {
  assert.equal(guessName("Curriculum Vitae\nRohan Desai\nSenior Product Manager"), "Rohan Desai");
  assert.equal(guessName("Product Manager\n5 years experience"), null);
});

const PM: Rubric = {
  role: "PM",
  title: "Product Manager",
  threshold: 65,
  lower_tier_below: 45,
  scale: {},
  notes: null,
  criteria: [
    { key: "logistics_ops", name: "a", weight: 25, guidance: "" },
    { key: "self_initiated_build", name: "b", weight: 25, guidance: "" },
    { key: "crisis_ownership", name: "c", weight: 20, guidance: "" },
    { key: "ship_and_kill", name: "d", weight: 15, guidance: "" },
    { key: "structure_from_zero", name: "e", weight: 15, guidance: "" },
  ],
};

test("weighted sum: all 5s = 100, all 1s = 20", () => {
  const all = (n: number) => PM.criteria.map((c) => ({ key: c.key, score: n }));
  assert.equal(computeRubricScore(PM, all(5)).total, 100);
  assert.equal(computeRubricScore(PM, all(1)).total, 20);
});

test("mixed scores follow Σ(score/5)×weight", () => {
  const raw = [
    { key: "logistics_ops", score: 5 }, // 25
    { key: "self_initiated_build", score: 4 }, // 20
    { key: "crisis_ownership", score: 3 }, // 12
    { key: "ship_and_kill", score: 2 }, // 6
    { key: "structure_from_zero", score: 1 }, // 3
  ];
  assert.equal(computeRubricScore(PM, raw).total, 66);
});

test("missing criterion scores 1 and out-of-range values clamp", () => {
  const { total, criteria } = computeRubricScore(PM, [
    { key: "logistics_ops", score: 9 },
    { key: "self_initiated_build", score: 0 },
  ]);
  assert.equal(criteria[0].score, 5);
  assert.equal(criteria[1].score, 1);
  assert.equal(criteria[2].score, 1);
  assert.equal(criteria[2].evidence, "No evidence in the CV");
  assert.equal(total, 25 + 5 + 4 + 3 + 3);
});

test("recommendation uses role threshold; tiers", () => {
  assert.equal(recommendationFor(PM, 65), "invite");
  assert.equal(recommendationFor(PM, 64.9), "reject");
  assert.equal(tierFor(PM, 70), "strong");
  assert.equal(tierFor(PM, 50), "borderline");
  assert.equal(tierFor(PM, 40), "lower");
});
