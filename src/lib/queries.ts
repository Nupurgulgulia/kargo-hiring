import "server-only";
import { db } from "./supabase";
import type { Brief, Candidate, EmailRow, EventRow, ScoreRow } from "./types";

export type ListRow = Pick<
  Candidate,
  | "id"
  | "created_at"
  | "applied_role"
  | "full_name"
  | "email"
  | "status"
  | "error"
  | "decision"
  | "pm_score"
  | "spm_score"
  | "applied_score"
  | "recommendation"
> & {
  headline: string | null;
  email_status: EmailRow["status"] | null;
  email_kind: EmailRow["kind"] | null;
};

export async function listCandidates(): Promise<ListRow[]> {
  const { data, error } = await db()
    .from("kargo_candidates")
    .select(
      "id, created_at, applied_role, full_name, email, status, error, decision, pm_score, spm_score, applied_score, recommendation, extracted, kargo_emails(status, kind)",
    )
    .order("applied_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const { extracted, kargo_emails, ...rest } = r as unknown as Candidate & {
      kargo_emails: { status: EmailRow["status"]; kind: EmailRow["kind"] } | null;
    };
    return {
      ...rest,
      headline: extracted?.headline ?? null,
      email_status: kargo_emails?.status ?? null,
      email_kind: kargo_emails?.kind ?? null,
    } as ListRow;
  });
}

export async function getCandidateDetail(id: string) {
  const [c, scores, brief, email, events] = await Promise.all([
    db().from("kargo_candidates").select("*").eq("id", id).maybeSingle(),
    db().from("kargo_scores").select("*").eq("candidate_id", id),
    db().from("kargo_briefs").select("content").eq("candidate_id", id).maybeSingle(),
    db().from("kargo_emails").select("*").eq("candidate_id", id).maybeSingle(),
    db().from("kargo_events").select("*").eq("candidate_id", id).order("at", { ascending: false }).limit(100),
  ]);
  if (!c.data) return null;
  return {
    candidate: c.data as Candidate,
    scores: (scores.data ?? []) as ScoreRow[],
    brief: (brief.data?.content as Brief) ?? null,
    email: (email.data as EmailRow) ?? null,
    events: (events.data ?? []) as EventRow[],
  };
}
