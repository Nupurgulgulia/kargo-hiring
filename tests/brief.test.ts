import assert from "node:assert/strict";
import { test } from "node:test";
import { scoresLine, scrubBrief, summaryOf, validateBrief, type BriefContent } from "../src/lib/brief-rules.ts";

// Verbatim from the brief the app wrote for the first sample candidate before this change.
const VERDICT_SUMMARY =
  "The candidate is a strong fit for the Product Manager role, scoring 100/100 on the PM rubric and demonstrating exceptional ground-level logistics exposure and zero-to-one process building. " +
  "Notably, the candidate actually scored slightly higher on the PM rubric (100) than the SPM rubric (91), primarily due to lacking complex third-party integration experience required for the SPM track. " +
  "Arjun should hire this candidate for the core operations platform PM seat where their Allcargo domain background and ShipDesk zero-to-one execution will compound immediately.";

const EVIDENCE_SUMMARY =
  "Scores 100 on the PM rubric (strong-hire line 65) and 91 on the SPM rubric (line 60). The SPM score is lower because the CV shows no integration or data-pipeline work. " +
  "Logistics exposure is rated 5/5: two years on a freight forwarder's export documentation desk.";

const brief = (o: Partial<BriefContent> = {}): BriefContent => ({
  headline: "First-hire PM with freight forwarding operations experience; PM 100, SPM 91.",
  evidence_summary: EVIDENCE_SUMMARY,
  strengths: ["Two years inside a freight forwarder handling ocean freight documents and customs."],
  gaps: ["No evidence of owning an integration layer or data pipeline."],
  questions: [{ question: "How did you decide to kill the carrier chat feature?", probes: "Use of usage data against customer demand." }],
  verify: ["Adoption figures for the bill-of-lading feature."],
  ...o,
});

test("an evidence-and-scores brief passes", () => {
  assert.deepEqual(validateBrief(brief()), []);
});

test("the verdict sentences the app actually produced are caught", () => {
  const problems = validateBrief(brief({ evidence_summary: VERDICT_SUMMARY }));
  const joined = problems.join(" | ").toLowerCase();
  assert.match(joined, /strong fit/);
  assert.match(joined, /"arjun should"/);
  assert.match(joined, /"should hire"/);
  assert.match(joined, /will compound/);
});

test("conclusions stated as fact are rejected in every field", () => {
  for (const bad of [
    "Arjun should interview this person.",
    "An ideal candidate for the seat.",
    "A great match for Kargo.",
    "This is a no-brainer.",
    "The candidate will thrive here.",
    "I recommend moving forward.",
    "Clearly a strong hire.",
    "Well suited to the role.",
    "Should be hired.",
  ]) {
    assert.ok(validateBrief(brief({ evidence_summary: `${EVIDENCE_SUMMARY} ${bad}` })).length > 0, `summary not caught: ${bad}`);
    assert.ok(validateBrief(brief({ headline: bad })).length > 0, `headline not caught: ${bad}`);
    assert.ok(validateBrief(brief({ strengths: [bad] })).length > 0, `strengths not caught: ${bad}`);
  }
});

test("plain evidence about scores and gaps is not mistaken for a verdict", () => {
  const ok = brief({
    evidence_summary:
      "The PM score (100) is above the SPM score (91). Criteria driving the difference: integration complexity 2/5 and standards 4/5. The candidate scored 100 against a strong-hire line of 65.",
    gaps: ["No evidence of institutionalising a standard others adopted after leaving.", "Only 3 years of PM experience against the 2 to 4 the role asks for."],
    verify: ["Ask references how the candidate handles a developer pushing back on a timeline."],
  });
  assert.deepEqual(validateBrief(ok), []);
});

test("gendered pronouns and an empty summary are rejected", () => {
  assert.ok(validateBrief(brief({ strengths: ["She ran the desk."] })).some((p) => /pronoun/i.test(p)));
  assert.ok(validateBrief(brief({ evidence_summary: "   " })).some((p) => /empty/.test(p)));
});

test("scrub removes only the verdict sentences and puts a facts-only scores line in front", () => {
  const line = scoresLine([
    { role: "PM", total: 100, threshold: 65 },
    { role: "SPM", total: 91, threshold: 60 },
  ]);
  assert.equal(line, "Scores: PM 100/100 (strong-hire line 65), SPM 91/100 (strong-hire line 60).");

  const { brief: out, removed } = scrubBrief(
    { ...brief(), evidence_summary: undefined, fit_summary: VERDICT_SUMMARY, headline: "A strong fit for the PM seat." },
    line,
  );
  assert.equal(removed.length, 3, removed.join(" || ")); // two summary sentences and the headline
  const summary = summaryOf(out);
  assert.ok(summary.startsWith(line));
  assert.match(summary, /scored slightly higher on the PM rubric \(100\) than the SPM rubric \(91\)/);
  assert.ok(!/strong fit|Arjun should|compound/i.test(summary));
  assert.equal(out.headline, line);
  assert.equal(out.fit_summary, undefined); // the old field name is retired by the scrub
  assert.deepEqual(validateBrief(out), []);
});

test("scrub drops verdict bullets and leaves clean ones alone", () => {
  const line = "Scores: PM 50/100 (strong-hire line 65).";
  const { brief: out, removed } = scrubBrief(
    brief({ strengths: ["Two years in freight forwarding.", "A strong candidate overall."], gaps: ["No integration work."], verify: ["Arjun should call two references."] }),
    line,
  );
  assert.deepEqual(out.strengths, ["Two years in freight forwarding."]);
  assert.deepEqual(out.gaps, ["No integration work."]);
  assert.deepEqual(out.verify, []);
  assert.equal(removed.length, 2);
  assert.equal(summaryOf(out), EVIDENCE_SUMMARY); // untouched when nothing in it was removed
});

test("briefs stored under the old field name still read correctly", () => {
  assert.equal(summaryOf({ fit_summary: "old text" }), "old text");
  assert.equal(summaryOf({ evidence_summary: "new", fit_summary: "old" }), "new");
});
