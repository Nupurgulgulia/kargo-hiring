import type { EmailKind, EmailStatus } from "./types";

// The dashboard's email counters, derived from what was actually sent rather than from draft
// status alone: in test mode a send goes to the test address and leaves the draft unsent, so
// the draft status can't be the only source.

export type EmailStatRow = {
  status: "processing" | "ready" | "error";
  email_status: EmailStatus | null;
  email_kind: EmailKind | null;
  test_sends: number; // emails delivered to the test address (from the activity log)
  auto_handled: boolean; // a rejection was already emailed automatically (test or real)
};

// Is this candidate's draft still waiting for Arjun? A rejection already sent automatically (to the
// test address, which leaves its draft unsent) is not waiting for him.
export function isAwaitingYourSend(r: EmailStatRow): boolean {
  if (r.status !== "ready") return false;
  if (r.email_status !== "draft" && r.email_status !== "failed") return false;
  if (r.email_kind === "reject" && r.email_status === "draft" && r.auto_handled) return false;
  return true;
}

export function emailStats(rows: EmailStatRow[]) {
  // Emails that reached candidates.
  const sentToCandidates = rows.filter((r) => r.email_status === "sent").length;
  // Emails delivered by Resend to the test address while test mode is on.
  const testSends = rows.reduce((sum, r) => sum + (r.test_sends || 0), 0);
  const awaitingYourSend = rows.filter(isAwaitingYourSend).length;
  return { sentToCandidates, testSends, awaitingYourSend };
}
