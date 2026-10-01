import "server-only";
import { one, query } from "./db";
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
  // Emails really delivered by Resend in test mode (they go to the test address and leave the
  // draft unsent, so they are counted from the activity log, not from the draft status).
  test_sends: number;
  // A test or real rejection was already sent automatically; Arjun has nothing left to do for it.
  auto_handled: boolean;
};

export async function listCandidates(): Promise<ListRow[]> {
  return query<ListRow>(
    `select c.id, c.created_at, c.applied_role, c.full_name, c.email, c.status, c.error, c.decision,
            c.pm_score, c.spm_score, c.applied_score, c.recommendation,
            c.extracted->>'headline' as headline, e.status as email_status, e.kind as email_kind,
            (select count(*)::int from kargo_events v where v.candidate_id = c.id and v.action = 'email_test_sent') as test_sends,
            exists (select 1 from kargo_events v where v.candidate_id = c.id
                      and v.action in ('email_sent', 'email_test_sent') and v.detail->>'auto' = 'true') as auto_handled
       from kargo_candidates c
       left join kargo_emails e on e.candidate_id = c.id
      order by c.applied_score desc nulls last, c.created_at desc`,
  );
}

export async function getCandidateDetail(id: string) {
  const [candidate, scores, brief, email, events] = await Promise.all([
    one<Candidate>("select * from kargo_candidates where id = $1", [id]),
    query<ScoreRow>("select * from kargo_scores where candidate_id = $1", [id]),
    one<{ content: Brief }>("select content from kargo_briefs where candidate_id = $1", [id]),
    one<EmailRow>("select * from kargo_emails where candidate_id = $1", [id]),
    query<EventRow>("select * from kargo_events where candidate_id = $1 order by at desc limit 100", [id]),
  ]);
  if (!candidate) return null;
  return { candidate, scores, brief: brief?.content ?? null, email, events };
}
