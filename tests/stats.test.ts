import assert from "node:assert/strict";
import { test } from "node:test";
import { emailStats, isAwaitingYourSend, type EmailStatRow } from "../src/lib/stats.ts";

const row = (o: Partial<EmailStatRow>): EmailStatRow => ({
  status: "ready",
  email_status: "draft",
  email_kind: "invite",
  test_sends: 0,
  ...o,
});

test("one Emails sent number: real sends plus test sends", () => {
  const rows = [
    row({ email_kind: "invite", test_sends: 2 }),
    row({ email_kind: "reject", test_sends: 3 }),
    row({ email_kind: "reject", email_status: "sent" }), // really sent to a candidate
    row({ email_kind: "invite", email_status: "failed" }),
    row({ status: "processing", email_status: null, email_kind: null }), // still scoring
  ];
  const s = emailStats(rows, true);
  assert.equal(s.emailsSent, 6);
  assert.equal(s.sentToCandidates, 1);
  assert.equal(s.testSends, 5);
});

test("in test mode, a test-sent draft is done; a failed or untouched one still awaits", () => {
  assert.ok(!isAwaitingYourSend(row({ test_sends: 1 }), true));
  assert.ok(isAwaitingYourSend(row({ test_sends: 0 }), true));
  assert.ok(isAwaitingYourSend(row({ email_status: "failed", test_sends: 2 }), true));
  assert.ok(!isAwaitingYourSend(row({ email_status: "sent" }), true));
  assert.equal(emailStats([row({ test_sends: 2 }), row({ email_kind: "reject", test_sends: 3 })], true).awaitingYourSend, 0);
});

test("with test mode off, test sends no longer count: nothing reached the candidate", () => {
  assert.ok(isAwaitingYourSend(row({ test_sends: 2 }), false));
  assert.equal(emailStats([row({ test_sends: 2 }), row({ email_kind: "reject", test_sends: 3 })], false).awaitingYourSend, 2);
});
