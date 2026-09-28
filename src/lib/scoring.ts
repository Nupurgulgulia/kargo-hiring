import type { CriterionScore, EmailKind, Rubric } from "./types";

// Pure scoring math from rubric.txt:
//   final score = Σ (criterion score / 5) × criterion weight   (max 100)
// The LLM only assigns the 1–5 score per criterion; the weighted total is always computed here.

export type RawCriterionScore = {
  key: string;
  score: number;
  evidence?: string;
  rationale?: string;
};

export function clampScore(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(5, Math.max(1, v));
}

export function computeRubricScore(
  rubric: Rubric,
  raw: RawCriterionScore[],
): { total: number; criteria: CriterionScore[] } {
  const byKey = new Map(raw.map((r) => [r.key, r]));
  const criteria = rubric.criteria.map((c) => {
    const r = byKey.get(c.key);
    // Rubric rule: no evidence → score 1, never guess.
    const score = r ? clampScore(r.score) : 1;
    return {
      key: c.key,
      name: c.name,
      weight: c.weight,
      score,
      points: round1((score / 5) * c.weight),
      evidence: r?.evidence?.trim() || "No evidence in the CV",
      rationale: r?.rationale?.trim() || (r ? "" : "Criterion not returned by the model; scored 1."),
    };
  });
  const total = round1(criteria.reduce((sum, c) => sum + (c.score / 5) * c.weight, 0));
  return { total, criteria };
}

export function recommendationFor(rubric: Rubric, appliedScore: number): EmailKind {
  return appliedScore >= rubric.threshold ? "invite" : "reject";
}

export type Tier = "strong" | "borderline" | "lower";

// Tiers for display. PM has an explicit lower-tier line (~45); SPM only defines the 60+ line.
export function tierFor(rubric: Rubric, score: number | null): Tier | null {
  if (score == null) return null;
  if (score >= rubric.threshold) return "strong";
  if (rubric.lower_tier_below != null && score < rubric.lower_tier_below) return "lower";
  if (rubric.lower_tier_below == null) return "lower";
  return "borderline";
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
