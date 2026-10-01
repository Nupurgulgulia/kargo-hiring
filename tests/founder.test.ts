import assert from "node:assert/strict";
import { test } from "node:test";
import { foundersReadStatus, resemblanceLabel, validateFoundersRead, wordCount, type FoundersRead } from "../src/lib/founder-rules.ts";

const hireNames = ["Lavanya", "Rohan", "Sunita", "Meghna", "Aditya", "Vikram", "Rahul", "Preetham"];
const signalKeys = [
  "owns_the_miss",
  "absorbs_disruption",
  "leaves_a_standard",
  "stance_not_inventory",
  "autonomy_by_absence",
  "numbers_measure_others_pain",
  "operator_first",
  "credits_others",
];
const ctx = { hireNames, signalKeys };

const READ =
  "This candidate reminds me of Lavanya more than anyone. Both did real years inside a logistics operation before touching product, and the CV tells the same kind of story: " +
  "a tracker nobody asked for that two other teams ended up using, and a process that did not exist before. What I like is that they write about a missed shipment plainly and say what changed. " +
  "There is some of Rohan in the weekend prototype, too. Where it differs from both is scale: the rollouts here are smaller, so I would want to hear how they handle a problem with no one else in the room.";

const valid = (o: Partial<FoundersRead> = {}): FoundersRead => ({
  read: READ,
  match_quality: "partial",
  resembles: [
    { name: "Lavanya", why: "ops first, built unasked tools others adopted" },
    { name: "Rohan", why: "weekend prototype that spread" },
  ],
  signals: signalKeys.map((key) => ({ key, strength: "some" as const, note: "grounded in the CV" })),
  could_be_wrong: "Smaller scale than the CV suggests; the tracker may have been a team of one.",
  ...o,
});

test("fixture is a valid read of a sensible length", () => {
  assert.ok(wordCount(READ) >= 60 && wordCount(READ) <= 170, String(wordCount(READ)));
  assert.deepEqual(validateFoundersRead(valid(), ctx), []);
});

test("verdict language is rejected, however it is phrased", () => {
  for (const bad of [
    "You should hire this candidate.",
    "I would hire them without a second thought.",
    "I'd reject this one.",
    "Honestly a strong hire.",
    "My recommendation is to move on.",
    "We must interview them next week.",
    "Easy pass on this one, no-hire.",
  ]) {
    const problems = validateFoundersRead(valid({ read: `${READ} ${bad}` }), ctx);
    assert.ok(problems.some((p) => /Verdict language/.test(p)), `not caught: ${bad}`);
  }
});

test("describing a pattern or what to probe is not a verdict", () => {
  const ok = valid({
    read: `${READ} I would want to probe the interview question about the lost shipment, and I would not read too much into the thin first role.`,
  });
  assert.deepEqual(validateFoundersRead(ok, ctx), []);
});

test("gendered pronouns are rejected everywhere in the read", () => {
  for (const bad of ["She built it.", "He ran the team.", "I like his approach.", "Her numbers are good.", "Ask him about it."]) {
    assert.ok(validateFoundersRead(valid({ read: `${READ} ${bad}` }), ctx).some((p) => /pronoun/.test(p)), bad);
  }
  assert.ok(validateFoundersRead(valid({ could_be_wrong: "Perhaps she overstates it." }), ctx).some((p) => /pronoun/.test(p)));
  assert.ok(!validateFoundersRead(valid({ read: `${READ} They explain it well.` }), ctx).some((p) => /pronoun/.test(p)));
});

test("protected attributes are rejected", () => {
  for (const bad of ["Probably married with kids.", "A young woman, so", "Their accent is strong.", "The caste angle", "gender aside"]) {
    assert.ok(validateFoundersRead(valid({ read: `${READ} ${bad}` }), ctx).some((p) => /Protected/.test(p)), bad);
  }
  // ordinary words that merely contain those letters are fine
  assert.deepEqual(validateFoundersRead(valid({ read: `${READ} They manage a stage-gated usage review and an old process.` }), ctx), []);
});

test("only the eight past hires can be cited, and they must be named in the paragraph", () => {
  const invented = valid({ resembles: [{ name: "Priya", why: "x" }] });
  assert.ok(validateFoundersRead(invented, ctx).some((p) => /not one of the past hires/.test(p)));

  const notInParagraph = valid({ resembles: [{ name: "Sunita", why: "x" }] });
  assert.ok(validateFoundersRead(notInParagraph, ctx).some((p) => /must name Sunita/.test(p)));

  const unlisted = valid({ resembles: [{ name: "Lavanya", why: "x" }] }); // paragraph also mentions Rohan
  assert.ok(validateFoundersRead(unlisted, ctx).some((p) => /mentions Rohan/.test(p)));

  assert.ok(validateFoundersRead(valid({ resembles: [] }), ctx).some((p) => /one or two/.test(p)));
  assert.ok(validateFoundersRead(valid({ resembles: [...valid().resembles, { name: "Meghna", why: "x" }] }), ctx).some((p) => /one or two/.test(p)));
  assert.ok(
    validateFoundersRead(valid({ resembles: [{ name: "Lavanya", why: "x" }, { name: "Lavanya", why: "y" }] }), ctx).some((p) => /same past hire twice/.test(p)),
  );
});

test("length limits, signal coverage and redaction markers are enforced", () => {
  assert.ok(validateFoundersRead(valid({ read: "Lavanya, Rohan, short." }), ctx).some((p) => /at least/.test(p)));
  assert.ok(validateFoundersRead(valid({ read: `${READ} ${"word ".repeat(120)}` }), ctx).some((p) => /under/.test(p)));
  assert.ok(validateFoundersRead(valid({ signals: valid().signals.slice(1) }), ctx).some((p) => /Missing signal "owns_the_miss"/.test(p)));
  assert.ok(validateFoundersRead(valid({ signals: [...valid().signals, valid().signals[0]] }), ctx).some((p) => /exactly once/.test(p)));
  assert.ok(validateFoundersRead(valid({ read: `${READ} [CANDIDATE] did well.` }), ctx).some((p) => /Redaction markers/.test(p)));
  assert.ok(validateFoundersRead(valid({ could_be_wrong: "  " }), ctx).some((p) => /could_be_wrong/.test(p)));
});

test("resemblance label reads naturally", () => {
  assert.equal(resemblanceLabel({ resembles: [{ name: "Lavanya", why: "" }], match_quality: "close" }), "Lavanya (a close match)");
  assert.equal(
    resemblanceLabel({ resembles: [{ name: "Vikram", why: "" }, { name: "Rahul", why: "" }], match_quality: "loose" }),
    "Vikram and Rahul (only a loose match)",
  );
});

test("pending shows only for a few minutes after scoring, and stops on a failure", () => {
  const done = "2026-10-01T10:00:00.000Z";
  const at = (min: number) => new Date(new Date(done).getTime() + min * 60_000).toISOString();
  const ev = (action: string, when: string, detail: Record<string, unknown> | null = null) => ({ action, at: when, detail });
  const base = { status: "ready" as const, hasRead: false };
  const now = (min: number) => new Date(at(min)).getTime();

  assert.equal(foundersReadStatus({ ...base, events: [ev("pipeline_complete", done)] }, now(1)).pending, true);
  assert.equal(foundersReadStatus({ ...base, events: [ev("pipeline_complete", done)] }, now(5)).pending, false);
  // already written: never pending, never an error
  assert.deepEqual(foundersReadStatus({ ...base, hasRead: true, events: [ev("pipeline_complete", done)] }, now(1)), { pending: false, error: null });
  // failed after completion: stop waiting and show why
  const failed = foundersReadStatus({ ...base, events: [ev("founders_read_failed", at(0.5), { error: "quota" }), ev("pipeline_complete", done)] }, now(1));
  assert.deepEqual(failed, { pending: false, error: "quota" });
  // still scoring: not pending (the page has its own spinner)
  assert.equal(foundersReadStatus({ status: "processing", hasRead: false, events: [] }, now(1)).pending, false);
});
