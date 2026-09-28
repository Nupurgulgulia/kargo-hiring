import "server-only";
import { draftEmail, extractProfile, scoreAgainstRubric, writeBrief } from "./ai";
import { GEMINI_MODEL } from "./gemini";
import { assertNoPII } from "./pii";
import { recommendationFor } from "./scoring";
import { db, getRubrics, logEvent } from "./supabase";
import type { Brief, Candidate, EmailKind, Extraction, Role } from "./types";
import { ROLES } from "./types";

// Processing pipeline for one candidate:
//   redacted CV → (AI 1) extraction → (AI 2) score vs PM AND SPM rubrics
//   → (AI 3) interview brief + (AI 4) email draft (invite or rejection).
// Nothing in here sends email. Sending happens only from the dashboard's Send action.

async function loadCandidate(id: string): Promise<Candidate> {
  const { data, error } = await db().from("kargo_candidates").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`Candidate ${id} not found`);
  return data as Candidate;
}

export async function processCandidate(id: string) {
  const started = Date.now();
  try {
    const c = await loadCandidate(id);
    if (!c.redacted_text) throw new Error("No redacted CV text to process");
    const contact = { full_name: c.full_name, email: c.email, phone: c.phone };
    assertNoPII(c.redacted_text, contact);

    const rubrics = await getRubrics();

    // AI step 1 — extraction
    const extraction = await extractProfile(c.redacted_text);
    assertNoPII(JSON.stringify(extraction), contact);
    await db().from("kargo_candidates").update({ extracted: extraction }).eq("id", id);
    await logEvent(id, "ai", "extracted", { model: GEMINI_MODEL, roles: extraction.roles.length });

    // AI step 2 — score against BOTH rubrics, regardless of the role applied for
    const scored = await Promise.all(
      ROLES.map(async (role) => ({
        role,
        ...(await scoreAgainstRubric(rubrics[role], c.redacted_text!, extraction)),
      })),
    );
    const { error: scoreErr } = await db()
      .from("kargo_scores")
      .upsert(
        scored.map((s) => ({
          candidate_id: id,
          role: s.role,
          total: s.total,
          criteria: s.criteria,
          summary: s.summary,
          model: GEMINI_MODEL,
          created_at: new Date().toISOString(),
        })),
        { onConflict: "candidate_id,role" },
      );
    if (scoreErr) throw new Error(`Saving scores failed: ${scoreErr.message}`);

    const byRole = Object.fromEntries(scored.map((s) => [s.role, s])) as Record<Role, (typeof scored)[number]>;
    const applied = byRole[c.applied_role];
    const recommendation = recommendationFor(rubrics[c.applied_role], applied.total);
    await db()
      .from("kargo_candidates")
      .update({
        pm_score: byRole.PM.total,
        spm_score: byRole.SPM.total,
        applied_score: applied.total,
        recommendation,
      })
      .eq("id", id);
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
    await db()
      .from("kargo_briefs")
      .upsert({ candidate_id: id, content: brief, model: GEMINI_MODEL, created_at: new Date().toISOString() });
    await logEvent(id, "ai", "brief_written", { model: GEMINI_MODEL });

    // AI step 4 — outreach draft (never sent here)
    await saveDraft(id, recommendation, c.applied_role, extraction, brief);

    await db().from("kargo_candidates").update({ status: "ready", error: null }).eq("id", id);
    await logEvent(id, "system", "pipeline_complete", { ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db().from("kargo_candidates").update({ status: "error", error: message }).eq("id", id);
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
  const { error } = await db().from("kargo_emails").upsert({
    candidate_id: id,
    kind,
    subject: draft.subject,
    body: draft.body,
    status: "draft",
    error: null,
    model: GEMINI_MODEL,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Saving draft failed: ${error.message}`);
  await logEvent(id, "ai", "email_drafted", { kind, model: GEMINI_MODEL });
}

// Used when Arjun overrides the recommendation, e.g. "draft an invite instead".
export async function redraftEmail(id: string, kind: EmailKind) {
  const c = await loadCandidate(id);
  if (!c.extracted) throw new Error("Candidate has not been processed yet");
  const { data: existing } = await db().from("kargo_emails").select("status").eq("candidate_id", id).maybeSingle();
  if (existing?.status === "sent" || existing?.status === "sending") {
    throw new Error("This candidate's email has already been sent");
  }
  assertNoPII(JSON.stringify(c.extracted), { full_name: c.full_name, email: c.email, phone: c.phone });
  const { data: briefRow } = await db().from("kargo_briefs").select("content").eq("candidate_id", id).maybeSingle();
  await saveDraft(id, kind, c.applied_role, c.extracted, (briefRow?.content as Brief) ?? null);
}
