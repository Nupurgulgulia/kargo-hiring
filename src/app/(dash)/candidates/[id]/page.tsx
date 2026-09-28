import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  AutoRefresh,
  CandidateActions,
  ContactEditor,
  DecisionNotes,
  EmailComposer,
} from "@/components/candidate-panels";
import { Badge, Card, CardHeader, ScoreBar } from "@/components/ui";
import { getCandidateDetail } from "@/lib/queries";
import { tierFor } from "@/lib/scoring";
import { getRubrics } from "@/lib/supabase";
import type { EventRow, Role, ScoreRow } from "@/lib/types";
import { ROLE_TITLES } from "@/lib/types";

const EVENT_LABELS: Record<string, string> = {
  cv_uploaded: "CV uploaded, personal details stripped",
  extracted: "AI extracted profile",
  scored: "AI scored on PM and SPM rubrics",
  brief_written: "AI wrote interview brief",
  email_drafted: "AI drafted email",
  pipeline_complete: "Ready for review",
  pipeline_failed: "Processing failed",
  reprocess_requested: "Re-score requested",
  redraft_requested: "Redraft requested",
  email_edited: "Draft edited",
  email_sent: "Email sent",
  email_send_failed: "Send failed",
  updated: "Record updated",
};

function describe(e: EventRow): string | null {
  const d = e.detail ?? {};
  if (e.action === "scored") return `PM ${d.PM} · SPM ${d.SPM} → ${d.recommendation === "invite" ? "interview" : "decline"} (line ${d.threshold})`;
  if (e.action === "email_drafted" || e.action === "redraft_requested") return String(d.kind ?? "");
  if (e.action === "email_sent") return `${d.kind} to ${d.to}`;
  if (e.action === "pipeline_failed" || e.action === "email_send_failed") return String(d.error ?? "");
  if (e.action === "updated") {
    const parts = [d.decision ? `decision: ${d.decision}` : null, d.notes ? `notes: “${String(d.notes).slice(0, 140)}”` : null];
    return parts.filter(Boolean).join(" · ") || (Array.isArray(d.fields) ? d.fields.join(", ") : null);
  }
  return null;
}

function Dots({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-2 w-2 rounded-full ${n <= score ? (score >= 4 ? "bg-good" : score === 3 ? "bg-warn" : "bg-muted") : "bg-surface-2 ring-1 ring-line"}`} />
      ))}
    </span>
  );
}

function RubricCard({ score, threshold, applied }: { score: ScoreRow; threshold: number; applied: boolean }) {
  return (
    <Card>
      <CardHeader
        title={`${ROLE_TITLES[score.role]} rubric`}
        sub={score.summary ?? undefined}
        aside={
          <div className="flex items-center gap-2">
            {applied && <Badge tone="accent">Applied role</Badge>}
            <div className="w-40"><ScoreBar score={score.total} threshold={threshold} /></div>
          </div>
        }
      />
      <ul className="divide-y divide-line">
        {score.criteria.map((c) => (
          <li key={c.key} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{c.name}</span>
              <span className="text-xs text-muted">weight {c.weight}</span>
              <span className="ml-auto flex items-center gap-2">
                <Dots score={c.score} />
                <span className="tabular w-14 text-right text-xs text-muted">{c.points}/{c.weight} pts</span>
              </span>
            </div>
            <p className="mt-1.5 border-l-2 border-line pl-2.5 text-[13px] italic text-muted">{c.evidence}</p>
            {c.rationale && <p className="mt-1 text-[13px]">{c.rationale}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default async function CandidatePage({ params }: PageProps<"/candidates/[id]">) {
  await connection();
  const { id } = await params;
  const [detail, rubrics] = await Promise.all([getCandidateDetail(id), getRubrics()]);
  if (!detail) notFound();
  const { candidate: c, scores, brief, email, events } = detail;

  const applied = c.applied_role;
  const other: Role = applied === "PM" ? "SPM" : "PM";
  const ordered = [applied, other]
    .map((r) => scores.find((s) => s.role === r))
    .filter((s): s is ScoreRow => Boolean(s));
  const tier = tierFor(rubrics[applied], c.applied_score);
  const otherScore = other === "PM" ? c.pm_score : c.spm_score;
  const crossRole =
    otherScore != null && otherScore >= rubrics[other].threshold && (c.applied_score ?? 0) < rubrics[applied].threshold;

  return (
    <div className="space-y-5">
      <AutoRefresh active={c.status === "processing"} />
      <Link href="/" className="text-sm text-muted hover:text-ink">← Shortlist</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{c.full_name ?? "Unnamed candidate"}</h1>
            <Badge tone="accent">Applied: {ROLE_TITLES[applied]}</Badge>
            {c.status === "ready" && (c.recommendation === "invite" ? <Badge tone="good">Recommend interview</Badge> : <Badge>Recommend decline</Badge>)}
          </div>
          <p className="mt-1 text-sm text-muted">
            {c.extracted?.headline ?? c.cv_filename}
            {c.extracted && ` · ${c.extracted.total_years_experience} yrs total, ${c.extracted.pm_years_experience} yrs PM`}
          </p>
        </div>
        <CandidateActions id={c.id} hasCv={Boolean(c.cv_storage_path)} locked={email?.status === "sent"} />
      </div>

      {c.status === "processing" && (
        <Card className="px-5 py-4 text-sm">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          Extracting, scoring on both rubrics, writing the brief and drafting outreach. This usually takes under a minute.
        </Card>
      )}
      {c.status === "error" && (
        <Card className="border-bad/40 bg-bad-soft px-5 py-4 text-sm text-bad">Processing failed: {c.error}. Use Re-score to try again.</Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {c.status === "ready" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["PM", "SPM"] as Role[]).map((r) => {
                const s = r === "PM" ? c.pm_score : c.spm_score;
                return (
                  <div key={r} className={`rounded-xl border bg-surface px-4 py-3 ${r === applied ? "border-accent/50" : "border-line"}`}>
                    <p className="text-xs text-muted">{ROLE_TITLES[r]} score {r === applied && "· applied"}</p>
                    <div className="mt-2"><ScoreBar score={s} threshold={rubrics[r].threshold} /></div>
                    <p className="mt-1.5 text-xs text-muted">
                      {s != null && s >= rubrics[r].threshold ? `At or above the ${rubrics[r].threshold} line that resembles Kargo's strongest hires` : `Below the ${rubrics[r].threshold} strong-hire line`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {crossRole && (
            <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
              Scores below the line for {applied} but clears the {other} line ({Math.round(otherScore!)}). Worth considering for {ROLE_TITLES[other]}.
            </p>
          )}
          {tier === "lower" && applied === "SPM" && (
            <p className="text-xs text-muted">
              Note from calibration: the SPM rubric reliably separates “Exceeds” from “did not exceed”, but is not a precise ranking within the lower tier.
            </p>
          )}

          {brief && (
            <Card>
              <CardHeader title="Interview brief" sub={brief.headline} />
              <div className="space-y-4 p-4 text-sm sm:p-5">
                <p className="leading-relaxed">{brief.fit_summary}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-good">Strengths</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">{brief.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-warn">Gaps and risks</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">{brief.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Questions to ask</h3>
                  <ol className="mt-1.5 space-y-2.5">
                    {brief.questions.map((q, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="tabular text-muted">{i + 1}.</span>
                        <div>
                          <p className="font-medium">{q.question}</p>
                          <p className="text-[13px] text-muted">Listen for: {q.probes}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                {brief.verify.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Verify in references</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">{brief.verify.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            </Card>
          )}

          {ordered.map((s) => (
            <RubricCard key={s.role} score={s} threshold={rubrics[s.role].threshold} applied={s.role === applied} />
          ))}

          {c.redacted_text && (
            <details className="rounded-xl border border-line bg-surface">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium">What the AI saw (redacted CV text)</summary>
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap border-t border-line px-5 py-4 font-mono text-xs leading-relaxed text-muted">
                {c.redacted_text}
              </pre>
            </details>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          {/* Remount on every server-side draft change (save, redraft, send) to reset local edits. */}
          {email && <EmailComposer key={`${email.updated_at}-${email.status}`} candidate={c} email={email} recommendation={c.recommendation} />}
          <DecisionNotes candidate={c} />
          <ContactEditor candidate={c} />
          <Card>
            <CardHeader title="Activity" sub="Every AI step and every action you take." />
            <ol className="max-h-96 space-y-2.5 overflow-auto p-4 text-sm sm:p-5">
              {events.map((e) => {
                const extra = describe(e);
                return (
                  <li key={e.id} className="flex gap-2.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.actor === "arjun" ? "bg-accent" : e.actor === "ai" ? "bg-warn" : "bg-muted"}`} />
                    <div className="min-w-0">
                      <p>
                        {EVENT_LABELS[e.action] ?? e.action}
                        <span className="ml-1.5 text-xs text-muted">{e.actor === "arjun" ? "you" : e.actor}</span>
                      </p>
                      {extra && <p className="break-words text-xs text-muted">{extra}</p>}
                      <p className="text-xs text-muted">{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}
