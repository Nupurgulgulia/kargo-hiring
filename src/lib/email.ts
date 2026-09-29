import "server-only";
import { Resend } from "resend";
import { logEvent, one, query } from "./db";
import { firstName } from "./pii";
import type { Candidate, EmailRow } from "./types";

// Fills the {{first_name}} placeholder. The AI never sees the name; it's inserted here.
export function personalise(text: string, fullName: string | null) {
  return text.replace(/\{\{\s*first_name\s*\}\}/g, firstName(fullName) || "there");
}

// Test mode: when EMAIL_TEST_RECIPIENT is set, every send goes to that address instead of the
// candidate's. Test sends leave the draft unsent, so it can be re-tested and later sent for real.
export function testRecipient(): string | null {
  return process.env.EMAIL_TEST_RECIPIENT?.trim() || null;
}

// Sends a candidate's draft. Called ONLY from the Send route, which is triggered by Arjun
// clicking Send on the dashboard. Claims the row atomically (draft/failed → sending) so a
// double click can never send twice, and passes an idempotency key to Resend.
export async function sendCandidateEmail(candidateId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM must be set");

  const c = await one<Candidate>("select * from kargo_candidates where id = $1", [candidateId]);
  if (!c) throw new Error("Candidate not found");
  const testTo = testRecipient();
  if (!testTo && !c.email) throw new Error("No email address on file for this candidate. Add one first.");
  const to = testTo ?? c.email!;

  const claimed = await one<EmailRow>(
    `update kargo_emails set status = 'sending', error = null, updated_at = now()
     where candidate_id = $1 and status in ('draft', 'failed') returning *`,
    [candidateId],
  );
  if (!claimed) throw new Error("There is no unsent draft for this candidate (it may already have been sent).");

  const personalised = personalise(claimed.subject, c.full_name);
  const subject = testTo ? `[TEST for ${c.email ?? "no email on file"}] ${personalised}` : personalised;
  const text = personalise(claimed.body, c.full_name);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(
    {
      from,
      to,
      subject,
      text,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
    },
    { idempotencyKey: `kargo-${candidateId}-${claimed.updated_at}` },
  );

  if (error || !data) {
    const msg = error?.message ?? "Unknown Resend error";
    await query("update kargo_emails set status = 'failed', error = $2 where candidate_id = $1", [candidateId, msg]);
    await logEvent(candidateId, "arjun", "email_send_failed", { error: msg, ...(testTo ? { test: true, to } : {}) });
    throw new Error(msg);
  }

  const sentAt = new Date().toISOString();
  if (testTo) {
    await query("update kargo_emails set status = 'draft', resend_id = $2, error = null where candidate_id = $1", [
      candidateId,
      data.id,
    ]);
    await logEvent(candidateId, "arjun", "email_test_sent", {
      kind: claimed.kind,
      to,
      intended: c.email,
      resend_id: data.id,
    });
    return { id: data.id, sentAt, test: true, to };
  }

  await query(
    `update kargo_emails set status = 'sent', resend_id = $2, sent_at = $3, sent_to = $4, error = null
     where candidate_id = $1`,
    [candidateId, data.id, sentAt, c.email],
  );
  await query("update kargo_candidates set decision = $2 where id = $1 and decision = 'pending'", [
    candidateId,
    claimed.kind === "invite" ? "invite" : "reject",
  ]);
  await logEvent(candidateId, "arjun", "email_sent", { kind: claimed.kind, to: c.email, resend_id: data.id });
  return { id: data.id, sentAt, test: false, to };
}
