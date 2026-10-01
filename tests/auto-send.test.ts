import assert from "node:assert/strict";
import { test } from "node:test";
import { autoSendRejectionsEnabled, shouldAutoSend } from "../src/lib/auto-send.ts";
import { emailStats, isAwaitingYourSend, type EmailStatRow } from "../src/lib/stats.ts";

const base = { enabled: true, recommendation: "reject", draftKind: "reject", decision: "pending" } as const;

test("auto-sends only an undecided candidate's rejection, and only when enabled", () => {
  assert.deepEqual(shouldAutoSend(base), { send: true });
  assert.equal(shouldAutoSend({ ...base, enabled: false }).send, false);
});

test("never auto-sends an invite, however it got there", () => {
  assert.equal(shouldAutoSend({ ...base, recommendation: "invite", draftKind: "invite" }).send, false);
  // Arjun redrafted a rejection-recommended candidate as an invite: still not automatic.
  assert.equal(shouldAutoSend({ ...base, draftKind: "invite" }).send, false);
  // Recommended invite but the draft was switched to a rejection: not automatic either.
  assert.equal(shouldAutoSend({ ...base, recommendation: "invite" }).send, false);
});

test("Arjun's own decision overrides automatic sending", () => {
  for (const decision of ["invite", "hold", "reject"] as const) {
    const r = shouldAutoSend({ ...base, decision });
    assert.equal(r.send, false, decision);
  }
  const held = shouldAutoSend({ ...base, decision: "hold" });
  assert.ok(!held.send && /hold/.test(held.reason));
});

test("AUTO_SEND_REJECTIONS is off unless explicitly turned on", () => {
  const saved = process.env.AUTO_SEND_REJECTIONS;
  try {
    delete process.env.AUTO_SEND_REJECTIONS;
    assert.equal(autoSendRejectionsEnabled(), false);
    for (const v of ["", "false", "0", "no", "off", "maybe"]) {
      process.env.AUTO_SEND_REJECTIONS = v;
      assert.equal(autoSendRejectionsEnabled(), false, v);
    }
    for (const v of ["true", "TRUE", "1", "yes", " on "]) {
      process.env.AUTO_SEND_REJECTIONS = v;
      assert.equal(autoSendRejectionsEnabled(), true, v);
    }
  } finally {
    if (saved === undefined) delete process.env.AUTO_SEND_REJECTIONS;
    else process.env.AUTO_SEND_REJECTIONS = saved;
  }
});

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
