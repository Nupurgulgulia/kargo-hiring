import type { EmailKind, EmailStatus } from "./types";

// The dashboard's email counters, derived from what was actually sent rather than from draft
// status alone: in test mode a send goes to the test address and leaves the draft unsent, so
// the draft status can't be the only source.

export type EmailStatRow = {
  status: "processing" | "ready" | "error";
  email_status: EmailStatus | null;
  email_kind: EmailKind | null;
  test_sends: number; // emails delivered to the test address (from the activity log)
};

// Is this candidate's email still waiting to be sent? While test mode is on, a draft that has been
// test-sent counts as done (a send was made, to the test address). When test mode is off, test sends
// stop counting: nothing has reached the candidate, so the draft is awaiting again.
export function isAwaitingYourSend(r: EmailStatRow, testMode: boolean): boolean {
  if (r.status !== "ready") return false;
  if (r.email_status !== "draft" && r.email_status !== "failed") return false;
  if (testMode && r.email_status === "draft" && r.test_sends > 0) return false;
  return true;
}

export function emailStats(rows: EmailStatRow[], testMode: boolean) {
  // Emails that reached candidates.
  const sentToCandidates = rows.filter((r) => r.email_status === "sent").length;
  // Emails delivered by Resend to the test address while test mode is on.
  const testSends = rows.reduce((sum, r) => sum + (r.test_sends || 0), 0);
  // Every email Resend delivered, to a candidate or to the test address: the one "Emails sent" number.
  const emailsSent = sentToCandidates + testSends;
  const awaitingYourSend = rows.filter((r) => isAwaitingYourSend(r, testMode)).length;
  return { emailsSent, sentToCandidates, testSends, awaitingYourSend };
}
