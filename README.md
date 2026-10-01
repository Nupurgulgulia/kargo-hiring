# Kargo Hiring Dashboard

A ranked PM / SPM shortlist for Arjun. Upload a CV, pick the role, and the app scores the candidate against **both** calibrated rubrics, writes an interview brief, and drafts an invite or rejection. **Invites are only ever sent when Arjun clicks Send and confirms. Rejections are emailed automatically once scoring finishes (`AUTO_SEND_REJECTIONS=true`).**

## Flow

| Stage | Where | What happens |
|---|---|---|
| Trigger | Dashboard | Arjun uploads one or more CVs and selects PM or SPM |
| Input | `POST /api/candidates` | File + role |
| Context | Server (`lib/cv-parse.ts`, `lib/pii.ts`) | Text extracted from PDF/DOCX/TXT. Name, email, phone moved into their own columns, then scrubbed (with profile URLs) from the text. A PII guard refuses any AI call whose payload still contains them. If no name is found, Arjun is asked for it before anything reaches the AI. |
| Processing + AI | `lib/pipeline.ts`, `lib/ai.ts` (Gemini Flash) | 1. Extract profile → 2. Score vs PM rubric **and** SPM rubric (AI assigns 1–5 per criterion with verbatim evidence; weighted total `Σ(score/5)×weight` computed in code) → 3. Interview brief → 4. Draft email: invite if the applied-role score clears its line (PM 65, SPM 60), otherwise rejection. The AI writes `{{first_name}}`; the real name is filled in only when sending. |
| Output | `/`, `/candidates/[id]` | Ranked shortlist with both scores, brief, per-criterion evidence, editable draft, decision + notes, full activity log |
| Send | `POST /api/candidates/[id]/send` and the end of the scoring pipeline (Resend) | **Invites:** only on Arjun's click + confirm. **Rejections:** automatic when scoring finishes, if `AUTO_SEND_REJECTIONS=true` and Arjun hasn't already marked the candidate. Either way a candidate can only be emailed once: the draft is claimed atomically and sent with a Resend idempotency key. |

The rubric lives in the `kargo_rubrics` table and is shown at `/rubric`; the scoring prompt and weights are read from it.

## Data (Neon Postgres, project `dry-bird-77072578`, branch `production`)

`kargo_rubrics`, `kargo_candidates` (PII only here), `kargo_scores` (one row per candidate per rubric), `kargo_briefs`, `kargo_emails`, `kargo_events` (audit trail), and `kargo_cv_files` (original uploads). The server connects with `pg` over the pooled `DATABASE_URL` (`src/lib/db.ts`); nothing talks to the database from the browser. Schema: `db/schema.sql`. Rubric seed: `db/seed_rubrics.sql`, checked against `db/rubric.txt`.

## Setup

1. `neon link --project-id dry-bird-77072578 --branch production` (writes `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to `.env.local`), then add the remaining keys from `.env.example`.
2. `npm install && npm run db:setup` to create the tables and seed both rubrics (safe to re-run).
3. `npm run dev`, then open http://localhost:3000 and try `samples/*.txt`.

On Vercel, set the same variables under Project → Settings → Environment Variables and redeploy.

> **Automatic rejections:** with `AUTO_SEND_REJECTIONS=true`, a candidate who scores below the line for the role they applied for gets their rejection emailed as soon as scoring finishes, unless Arjun has already marked them (interview / hold / decline). Rejections cannot be unsent, and the rubric is a screen, not a verdict, so turn this off if you want to review them first. Invites are never automatic. Skips and failures are recorded in the activity log, and a failed send stays on the dashboard to retry.

> **Email test mode:** while `EMAIL_TEST_RECIPIENT` is set, every send goes to that address instead of the candidate. The subject is unchanged, and the candidate it was meant for is recorded in the activity log. The draft stays unsent, and a yellow banner shows on the dashboard. Delete the variable (in Vercel too) to send to real candidates.

> **Resend:** until you verify a sending domain, `onboarding@resend.dev` only delivers to the email on your Resend account. Verify `kargo.in` (or similar) and set `EMAIL_FROM` before emailing real candidates.

## Scripts

- `npm test`: PII redaction and rubric-math unit tests
- `npm run db:setup`: apply schema and seed rubrics to Neon
- `npm run build`, `npm run lint`
