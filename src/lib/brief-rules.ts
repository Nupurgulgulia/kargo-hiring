// Rules for the interview brief: it lays out evidence and scores for Arjun to weigh and never
// states a recommendation or conclusion as fact. Pure, so it is unit-tested.

import { CONCLUSION, findVerdicts, scrubSentences, VERDICT_BASE } from "./verdict.ts";

export type BriefContent = {
  headline: string;
  evidence_summary?: string;
  fit_summary?: string; // the name briefs had before this became an evidence summary
  strengths: string[];
  gaps: string[];
  questions: { question: string; probes: string }[];
  verify: string[];
};

const BRIEF_PATTERNS = [...VERDICT_BASE, ...CONCLUSION];
const GENDERED = /\b(?:he|she|his|hers?|him|himself|herself)\b/i;

export const summaryOf = (b: Pick<BriefContent, "evidence_summary" | "fit_summary">) => b.evidence_summary ?? b.fit_summary ?? "";

function textFields(b: BriefContent): string[] {
  return [
    b.headline,
    summaryOf(b),
    ...b.strengths,
    ...b.gaps,
    ...b.verify,
    ...b.questions.flatMap((q) => [q.question, q.probes]),
  ];
}

// Returns the reasons a draft must be rewritten; empty when it is acceptable.
export function validateBrief(b: BriefContent): string[] {
  const problems: string[] = [];
  const found = new Set<string>();
  for (const t of textFields(b)) for (const v of findVerdicts(t, BRIEF_PATTERNS)) found.add(v.toLowerCase());
  for (const v of found) problems.push(`Verdict or conclusion stated as fact ("${v}"). Describe the evidence and the scores instead.`);
  if (textFields(b).some((t) => GENDERED.test(t))) problems.push('Gendered pronoun found. Use "the candidate" or "they".');
  if (!summaryOf(b).trim()) problems.push("`evidence_summary` is empty.");
  return problems;
}

// Backstop for a draft that still carries verdict language after a retry: drop the offending
// sentences and items, and put a plain facts-only scores line at the front of the summary. Nothing
// is invented; text is only removed.
export function scrubBrief(b: BriefContent, scoresLine: string): { brief: BriefContent; removed: string[] } {
  const removed: string[] = [];
  const keepItems = (items: string[]) =>
    items.filter((t) => {
      const bad = findVerdicts(t, BRIEF_PATTERNS).length > 0;
      if (bad) removed.push(t);
      return !bad;
    });

  const summary = scrubSentences(summaryOf(b), BRIEF_PATTERNS);
  removed.push(...summary.removed);
  const headlineBad = findVerdicts(b.headline, BRIEF_PATTERNS).length > 0;
  if (headlineBad) removed.push(b.headline);

  const brief: BriefContent = {
    headline: headlineBad ? scoresLine : b.headline,
    evidence_summary: summary.removed.length ? [scoresLine, summary.text].filter(Boolean).join(" ") : summaryOf(b),
    strengths: keepItems(b.strengths),
    gaps: keepItems(b.gaps),
    questions: b.questions.filter((q) => {
      const bad = findVerdicts(`${q.question} ${q.probes}`, BRIEF_PATTERNS).length > 0;
      if (bad) removed.push(q.question);
      return !bad;
    }),
    verify: keepItems(b.verify),
  };
  return { brief, removed };
}

export function scoresLine(scores: { role: string; total: number; threshold: number }[]): string {
  return `Scores: ${scores.map((s) => `${s.role} ${s.total}/100 (strong-hire line ${s.threshold})`).join(", ")}.`;
}
