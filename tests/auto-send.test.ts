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
  auto_handled: false,
  ...o,
});

test("counters reflect what was actually sent, including test sends", () => {
  const rows = [
    row({ email_kind: "invite", test_sends: 2 }), // invite, test-sent twice, still waiting for Arjun
    row({ email_kind: "reject", test_sends: 3, auto_handled: true }), // rejection already handled automatically
    row({ email_kind: "reject", email_status: "sent" }), // really sent to a candidate
    row({ email_kind: "invite", email_status: "failed" }), // failed: needs Arjun
    row({ status: "processing", email_status: null, email_kind: null }), // still scoring
  ];
  assert.deepEqual(emailStats(rows), { sentToCandidates: 1, testSends: 5, awaitingYourSend: 2 });
});

test("a rejection nobody has sent yet still counts as awaiting", () => {
  assert.ok(isAwaitingYourSend(row({ email_kind: "reject", auto_handled: false })));
  assert.ok(!isAwaitingYourSend(row({ email_kind: "reject", auto_handled: true })));
  // An auto-send that failed needs Arjun even though it was attempted automatically.
  assert.ok(isAwaitingYourSend(row({ email_kind: "reject", email_status: "failed", auto_handled: true })));
});
