import "server-only";
import { one, query } from "./db";
import type { Brief, Candidate, EmailRow, EventRow, FoundersReadRow, InstinctSignal, ReferenceHire, ScoreRow } from "./types";

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
  // Emails really delivered by Resend in test mode (they go to the test address and leave the
  // draft unsent, so they are counted from the activity log, not from the draft status).
  test_sends: number;
};

export async function listCandidates(): Promise<ListRow[]> {
  return query<ListRow>(
    `select c.id, c.created_at, c.applied_role, c.full_name, c.email, c.status, c.error, c.decision,
            c.pm_score, c.spm_score, c.applied_score, c.recommendation,
            c.extracted->>'headline' as headline, e.status as email_status, e.kind as email_kind,
            (select count(*)::int from kargo_events v where v.candidate_id = c.id and v.action = 'email_test_sent') as test_sends
       from kargo_candidates c
       left join kargo_emails e on e.candidate_id = c.id
      order by c.applied_score desc nulls last, c.created_at desc`,
  );
}

export async function getCandidateDetail(id: string) {
  const [candidate, scores, brief, email, events, founders] = await Promise.all([
    one<Candidate>("select * from kargo_candidates where id = $1", [id]),
    query<ScoreRow>("select * from kargo_scores where candidate_id = $1", [id]),
    one<{ content: Brief }>("select content from kargo_briefs where candidate_id = $1", [id]),
    one<EmailRow>("select * from kargo_emails where candidate_id = $1", [id]),
    query<EventRow>("select * from kargo_events where candidate_id = $1 order by at desc limit 100", [id]),
    one<FoundersReadRow>("select * from kargo_founder_reads where candidate_id = $1", [id]),
  ]);
  if (!candidate) return null;
  return { candidate, scores, brief: brief?.content ?? null, email, events, founders };
}

// Names, outcomes and signal labels the founder's-read card needs to label its chips.
export async function getInstinctLabels() {
  const [signals, hires] = await Promise.all([
    query<Pick<InstinctSignal, "key" | "name" | "position">>("select key, name, position from kargo_instinct_signals order by position"),
    query<Pick<ReferenceHire, "name" | "outcome" | "pm_score" | "spm_score">>("select name, outcome, pm_score, spm_score from kargo_reference_hires order by position"),
  ]);
  return {
    signalNames: Object.fromEntries(signals.map((s) => [s.key, s.name])) as Record<string, string>,
    signalOrder: signals.map((s) => s.key),
    hires: Object.fromEntries(hires.map((h) => [h.name, h])) as Record<string, Pick<ReferenceHire, "name" | "outcome" | "pm_score" | "spm_score">>,
  };
}
