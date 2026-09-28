import "server-only";
import { Resend } from "resend";
import { firstName } from "./pii";
import { db, logEvent } from "./supabase";
import type { Candidate, EmailRow } from "./types";

// Fills the {{first_name}} placeholder. The AI never sees the name; it's inserted here.
export function personalise(text: string, fullName: string | null) {
  return text.replace(/\{\{\s*first_name\s*\}\}/g, firstName(fullName) || "there");
}

// Sends a candidate's draft. Called ONLY from the Send route, which is triggered by Arjun
// clicking Send on the dashboard. Claims the row atomically (draft/failed → sending) so a
// double click can never send twice, and passes an idempotency key to Resend.
export async function sendCandidateEmail(candidateId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM must be set");

  const { data: c } = await db().from("kargo_candidates").select("*").eq("id", candidateId).single<Candidate>();
  if (!c) throw new Error("Candidate not found");
  if (!c.email) throw new Error("No email address on file for this candidate. Add one first.");

  const { data: claimed, error: claimErr } = await db()
    .from("kargo_emails")
    .update({ status: "sending", error: null, updated_at: new Date().toISOString() })
    .eq("candidate_id", candidateId)
    .in("status", ["draft", "failed"])
    .select("*")
    .maybeSingle<EmailRow>();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) throw new Error("There is no unsent draft for this candidate (it may already have been sent).");

  const subject = personalise(claimed.subject, c.full_name);
  const text = personalise(claimed.body, c.full_name);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(
    {
      from,
      to: c.email,
      subject,
      text,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
    },
    { idempotencyKey: `kargo-${candidateId}-${claimed.updated_at}` },
  );

  if (error || !data) {
    const msg = error?.message ?? "Unknown Resend error";
    await db().from("kargo_emails").update({ status: "failed", error: msg }).eq("candidate_id", candidateId);
    await logEvent(candidateId, "arjun", "email_send_failed", { error: msg });
    throw new Error(msg);
  }

  const sentAt = new Date().toISOString();
  await db()
    .from("kargo_emails")
    .update({ status: "sent", resend_id: data.id, sent_at: sentAt, sent_to: c.email, error: null })
    .eq("candidate_id", candidateId);
  await db()
    .from("kargo_candidates")
    .update({ decision: claimed.kind === "invite" ? "invite" : "reject" })
    .eq("id", candidateId)
    .eq("decision", "pending");
  await logEvent(candidateId, "arjun", "email_sent", { kind: claimed.kind, to: c.email, resend_id: data.id });
  return { id: data.id, sentAt };
}
