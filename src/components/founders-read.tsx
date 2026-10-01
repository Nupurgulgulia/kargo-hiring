"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resemblanceLabel } from "@/lib/founder-rules";
import type { FoundersReadRow, ReferenceHire } from "@/lib/types";
import { Badge, Card, CardHeader, buttonClass } from "./ui";

type Labels = {
  signalNames: Record<string, string>;
  signalOrder: string[];
  hires: Record<string, Pick<ReferenceHire, "name" | "outcome" | "pm_score" | "spm_score">>;
};

const OUTCOME_TONE = { exceeds: "good", meets: "neutral", below: "warn" } as const;
const OUTCOME_LABEL = { exceeds: "Exceeded expectations", meets: "Met expectations", below: "Below expectations" } as const;
const STRENGTH_TONE = { strong: "good", some: "accent", absent: "neutral" } as const;

// The founder's read: pattern-matching against Arjun's past hires. Display only. It sits beside the
// score and the brief and is wired to nothing that scores, recommends, decides or sends.
export function FoundersReadCard({
  candidateId,
  founders,
  labels,
  pending,
  lastError,
}: {
  candidateId: string;
  founders: FoundersReadRow | null;
  labels: Labels;
  pending: boolean;
  lastError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/founders-read`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <CardHeader
      title="Founder's read"
      sub="What the pattern-matching suggests. A prompt for your own judgment, not a verdict: it changes no score, recommendation or email."
      aside={<Badge tone="accent">AI draft in your voice</Badge>}
    />
  );

  if (!founders) {
    return (
      <Card>
        {header}
        <div className="flex flex-wrap items-center gap-3 p-4 text-sm sm:p-5">
          {pending && !busy ? (
            <p className="text-muted">
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              Comparing against your past hires…
            </p>
          ) : (
            <>
              <button className={buttonClass.secondary} onClick={write} disabled={busy}>
                {busy ? "Reading… (up to a minute)" : "Write the founder's read"}
              </button>
              <p className="text-muted">Compares this CV with your eight past hires.</p>
            </>
          )}
          {(error || (lastError && !pending)) && (
            <p className="w-full text-xs text-bad">Couldn&apos;t write it: {error ?? lastError}</p>
          )}
        </div>
      </Card>
    );
  }

  const r = founders.content;
  return (
    <Card>
      {header}
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-xs font-medium text-muted">Reminds me of</span>
          {r.resembles.map((m) => {
            const h = labels.hires[m.name];
            return (
              <span key={m.name} className="inline-flex items-center gap-1.5">
                <span className="text-sm font-semibold">{m.name}</span>
                {h && <Badge tone={OUTCOME_TONE[h.outcome]}>{OUTCOME_LABEL[h.outcome]}</Badge>}
              </span>
            );
          })}
          <span className="text-xs text-muted">· {r.match_quality === "close" ? "a close match" : r.match_quality === "partial" ? "a partial match" : "only a loose match"}</span>
        </div>

        <p className="text-sm leading-relaxed">{r.read}</p>

        <ul className="space-y-1 text-[13px] text-muted">
          {r.resembles.map((m) => (
            <li key={m.name}>
              <span className="font-medium text-ink">{m.name}:</span> {m.why}
            </li>
          ))}
        </ul>

        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
          <span className="font-medium">Where I could be wrong: </span>
          {r.could_be_wrong}
        </p>

        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">The eight signals behind this read</summary>
          <ul className="divide-y divide-line border-t border-line">
            {labels.signalOrder.map((key) => {
              const s = r.signals.find((x) => x.key === key);
              if (!s) return null;
              return (
                <li key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                  <span className="w-56 shrink-0 font-medium">{labels.signalNames[key] ?? key}</span>
                  <Badge tone={STRENGTH_TONE[s.strength]}>{s.strength === "absent" ? "not in the CV" : s.strength}</Badge>
                  <span className="min-w-0 flex-1 text-muted">{s.note}</span>
                </li>
              );
            })}
          </ul>
        </details>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {resemblanceLabel(r)}. Drawn from eight hires, so treat it as a hunch. Written {new Date(founders.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.
          </span>
          <button className={`${buttonClass.ghost} text-xs`} onClick={write} disabled={busy}>
            {busy ? "Rewriting…" : "Rewrite"}
          </button>
          {error && <span className="text-bad">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
