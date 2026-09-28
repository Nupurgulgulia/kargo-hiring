import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, aside, sub }: { title: string; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

// Score out of 100 with a tick at the role's strong-hire threshold.
export function ScoreBar({ score, threshold, compact = false }: { score: number | null; threshold: number; compact?: boolean }) {
  if (score == null) return <span className="text-xs text-muted">—</span>;
  const tone = score >= threshold ? "bg-good" : "bg-muted/60";
  return (
    <div className={`flex items-center gap-2 ${compact ? "min-w-24" : "min-w-36"}`}>
      <span className="tabular w-9 text-right text-sm font-semibold">{Math.round(score)}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-surface-2" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${Math.min(100, score)}%` }} />
        <div className="absolute -top-1 h-3.5 w-px bg-ink/50" style={{ left: `${threshold}%` }} title={`Threshold ${threshold}`} />
      </div>
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-bad/30 px-3.5 py-2 text-sm font-medium text-bad hover:bg-bad-soft disabled:opacity-50",
};

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
