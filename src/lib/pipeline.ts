import "server-only";
import { draftEmail, extractProfile, scoreAgainstRubric, writeBrief } from "./ai";
import { getRubrics, json, logEvent, one, query } from "./db";
import { activeModel } from "./gemini";
import { assertNoPII } from "./pii";
import { recommendationFor } from "./scoring";
import { errorMessage } from "./secrets";
import type { Brief, Candidate, EmailKind, Extraction, Role } from "./types";
import { ROLES } from "./types";

// Processing pipeline for one candidate:
//   redacted CV → (AI 1) extraction → (AI 2) score vs PM AND SPM rubrics
//   → (AI 3) interview brief + (AI 4) email draft (invite or rejection).
// Nothing in here sends email. Sending happens only from the dashboard's Send action.

async function loadCandidate(id: string): Promise<Candidate> {
  const row = await one<Candidate>("select * from kargo_candidates where id = $1", [id]);
  if (!row) throw new Error(`Candidate ${id} not found`);
  return row;
}

async function setCandidate(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await query(
    `update kargo_candidates set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

// resume: the previous run failed, so reuse its saved extraction instead of asking Gemini again.
export async function processCandidate(id: string, opts: { resume?: boolean } = {}) {
  const started = Date.now();
  try {
    const c = await loadCandidate(id);
    if (!c.redacted_text) throw new Error("No redacted CV text to process");
    const contact = { full_name: c.full_name, email: c.email, phone: c.phone };
    assertNoPII(c.redacted_text, contact);

    const rubrics = await getRubrics();

    // AI step 1 — extraction (skipped when resuming a failed run that already has one)
    let extraction: Extraction;
    if (opts.resume && c.extracted) {
      extraction = c.extracted;
      await logEvent(id, "system", "extraction_reused", { roles: extraction.roles.length });
    } else {
      extraction = await extractProfile(c.redacted_text);
      assertNoPII(JSON.stringify(extraction), contact);
      await query("update kargo_candidates set extracted = $2::jsonb where id = $1", [id, json(extraction)]);
      await logEvent(id, "ai", "extracted", { model: activeModel(), roles: extraction.roles.length });
    }

    // AI step 2 — score against BOTH rubrics, regardless of the role applied for.
    // One at a time: two simultaneous requests are what tipped Gemini into 503s.
    const scored = [];
    for (const role of ROLES) {
      scored.push({ role, ...(await scoreAgainstRubric(rubrics[role], c.redacted_text!, extraction)) });
    }
    for (const s of scored) {
      await query(
        `insert into kargo_scores (candidate_id, role, total, criteria, summary, model)
         values ($1, $2, $3, $4::jsonb, $5, $6)
         on conflict (candidate_id, role) do update set
           total = excluded.total, criteria = excluded.criteria, summary = excluded.summary,
           model = excluded.model, created_at = now()`,
        [id, s.role, s.total, json(s.criteria), s.summary, activeModel()],
      );
    }

    const byRole = Object.fromEntries(scored.map((s) => [s.role, s])) as Record<Role, (typeof scored)[number]>;
    const applied = byRole[c.applied_role];
    const recommendation = recommendationFor(rubrics[c.applied_role], applied.total);
    await setCandidate(id, {
      pm_score: byRole.PM.total,
      spm_score: byRole.SPM.total,
      applied_score: applied.total,
      recommendation,
    });
    await logEvent(id, "ai", "scored", {
      PM: byRole.PM.total,
      SPM: byRole.SPM.total,
      applied_role: c.applied_role,
      threshold: rubrics[c.applied_role].threshold,
      recommendation,
    });

    // AI step 3 — interview brief
    const brief = await writeBrief(
      c.applied_role,
      extraction,
      scored.map((s) => ({ role: s.role, total: s.total, threshold: rubrics[s.role].threshold, criteria: s.criteria })),
    );
    await query(
      `insert into kargo_briefs (candidate_id, content, model) values ($1, $2::jsonb, $3)
       on conflict (candidate_id) do update set content = excluded.content, model = excluded.model, created_at = now()`,
      [id, json(brief), activeModel()],
    );
    await logEvent(id, "ai", "brief_written", { model: activeModel() });

    // AI step 4 — outreach draft (never sent here)
    await saveDraft(id, recommendation, c.applied_role, extraction, brief);

    await setCandidate(id, { status: "ready", error: null });
    await logEvent(id, "system", "pipeline_complete", { ms: Date.now() - started });
  } catch (err) {
    const message = errorMessage(err);
    await setCandidate(id, { status: "error", error: message });
    await logEvent(id, "system", "pipeline_failed", { error: message });
  }
}

async function saveDraft(
  id: string,
  kind: EmailKind,
  role: Role,
  extraction: Extraction,
  brief: Brief | null,
) {
  const draft = await draftEmail(kind, role, extraction, brief);
  await query(
    `insert into kargo_emails (candidate_id, kind, subject, body, status, error, model)
     values ($1, $2, $3, $4, 'draft', null, $5)
     on conflict (candidate_id) do update set
       kind = excluded.kind, subject = excluded.subject, body = excluded.body,
       status = 'draft', error = null, model = excluded.model, updated_at = now()`,
    [id, kind, draft.subject, draft.body, activeModel()],
  );
  await logEvent(id, "ai", "email_drafted", { kind, model: activeModel() });
}

// Used when Arjun overrides the recommendation, e.g. "draft an invite instead".
export async function redraftEmail(id: string, kind: EmailKind) {
  const c = await loadCandidate(id);
  if (!c.extracted) throw new Error("Candidate has not been processed yet");
  const existing = await one<{ status: string }>("select status from kargo_emails where candidate_id = $1", [id]);
  if (existing?.status === "sent" || existing?.status === "sending") {
    throw new Error("This candidate's email has already been sent");
  }
  assertNoPII(JSON.stringify(c.extracted), { full_name: c.full_name, email: c.email, phone: c.phone });
  const briefRow = await one<{ content: Brief }>("select content from kargo_briefs where candidate_id = $1", [id]);
  await saveDraft(id, kind, c.applied_role, c.extracted, briefRow?.content ?? null);
}
