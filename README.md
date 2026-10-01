# Kargo Hiring Dashboard

A ranked PM / SPM shortlist for Arjun. Upload a CV, pick the role, and the app scores the candidate against **both** calibrated rubrics, writes an interview brief, and drafts an invite or rejection. **Nothing is ever emailed until Arjun clicks Send and confirms, invite or rejection alike.**

## Flow

| Stage | Where | What happens |
|---|---|---|
| Trigger | Dashboard | Arjun uploads one or more CVs and selects PM or SPM |
| Input | `POST /api/candidates` | File + role |
| Context | Server (`lib/cv-parse.ts`, `lib/pii.ts`) | Text extracted from PDF/DOCX/TXT. Name, email, phone moved into their own columns, then scrubbed (with profile URLs) from the text. A PII guard refuses any AI call whose payload still contains them. If no name is found, Arjun is asked for it before anything reaches the AI. |
| Processing + AI | `lib/pipeline.ts`, `lib/ai.ts` (Gemini Flash) | 1. Extract profile → 2. Score vs PM rubric **and** SPM rubric (AI assigns 1–5 per criterion with verbatim evidence; weighted total `Σ(score/5)×weight` computed in code) → 3. Interview brief (evidence, both scores and questions only; it never recommends or concludes, and is checked for verdict language, with offending sentences removed as a last resort) → 4. Draft email: invite if the applied-role score clears its line (PM 65, SPM 60), otherwise rejection. The AI writes `{{first_name}}`; the real name is filled in only when sending. |
| Founder's read | `lib/founder.ts` (AI step 5, optional) | After scoring, one paragraph in Arjun's voice on which of the eight past hires the CV most resembles and why, plus eight rated signals. Additive: it never changes a score, recommendation or email, and a failure never fails scoring. See `docs/founders-instinct.md`. |
| Output | `/`, `/candidates/[id]` | Ranked shortlist with both scores, founder's read, brief, per-criterion evidence, editable draft, decision + notes, full activity log |
| Send | `POST /api/candidates/[id]/send` (Resend) | Only on Arjun's click + confirm, for every email. Nothing else in the app can send: not the scoring pipeline, not a background job. Atomic claim + Resend idempotency key, so a double click can't send twice. |

The rubric lives in the `kargo_rubrics` table and is shown at `/rubric`; the scoring prompt and weights are read from it.

## Data (Neon Postgres, project `dry-bird-77072578`, branch `production`)

`kargo_rubrics`, `kargo_candidates` (PII only here), `kargo_scores` (one row per candidate per rubric), `kargo_briefs`, `kargo_emails`, `kargo_events` (audit trail), `kargo_cv_files` (original uploads), and the founder's-instinct tables `kargo_instinct_signals`, `kargo_reference_hires` and `kargo_founder_reads`. The server connects with `pg` over the pooled `DATABASE_URL` (`src/lib/db.ts`); nothing talks to the database from the browser. Schema: `db/schema.sql`. Rubric seed: `db/seed_rubrics.sql`, checked against `db/rubric.txt`. Founder's-instinct seed: `db/instinct.json`, whose scores and outcomes are also checked against `db/rubric.txt`.

## Setup

1. `neon link --project-id dry-bird-77072578 --branch production` (writes `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to `.env.local`), then add the remaining keys from `.env.example`.
2. `npm install && npm run db:setup` to create the tables and seed both rubrics (safe to re-run).
3. `npm run dev`, then open http://localhost:3000 and try `samples/*.txt`.

On Vercel, set the same variables under Project → Settings → Environment Variables and redeploy.

> **Email test mode:** while `EMAIL_TEST_RECIPIENT` is set, every send goes to that address instead of the candidate. The subject is unchanged, and the candidate it was meant for is recorded in the activity log. The draft stays unsent,. Delete the variable (in Vercel too) to send to real candidates.

> **Resend:** until you verify a sending domain, `onboarding@resend.dev` only delivers to the email on your Resend account. Verify `kargo.in` (or similar) and set `EMAIL_FROM` before emailing real candidates.

## Scripts

- `npm test`: PII redaction and rubric-math unit tests
- `npm run db:setup`: apply schema and seed rubrics to Neon
- `npm run build`, `npm run lint`
