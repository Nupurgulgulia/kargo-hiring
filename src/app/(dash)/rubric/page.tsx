import { connection } from "next/server";
import { Card, CardHeader } from "@/components/ui";
import { getRubrics } from "@/lib/db";
import type { Role } from "@/lib/types";

export default async function RubricPage() {
  await connection();
  const rubrics = await getRubrics();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scoring rubrics</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Calibrated against 8 past Kargo hires. Each criterion is scored 1–5 from CV evidence only; the final score is
          Σ (score ÷ 5) × weight, out of 100. Every candidate is scored on both rubrics. The AI assigns the 1–5 per criterion; the
          weighted total is computed in code.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {(["PM", "SPM"] as Role[]).map((role) => {
          const r = rubrics[role];
          return (
            <Card key={role}>
              <CardHeader title={`${r.title} (${role})`} sub={`Strong-hire line: ${r.threshold}+${r.lower_tier_below ? ` · below ~${r.lower_tier_below} resembles hires who did not exceed` : ""}`} />
              <ol className="divide-y divide-line">
                {r.criteria.map((c, i) => (
                  <li key={c.key} className="px-4 py-3 sm:px-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">{i + 1}. {c.name}</p>
                      <span className="tabular shrink-0 text-sm font-semibold text-accent">{c.weight}%</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{c.guidance}</p>
                  </li>
                ))}
              </ol>
              <div className="border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
                <p className="font-medium text-ink">Scale</p>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(r.scale)
                    .sort(([a], [b]) => Number(b) - Number(a))
                    .map(([k, v]) => (
                      <li key={k}><span className="tabular font-medium">{k}</span> = {v}</li>
                    ))}
                </ul>
                {r.notes && <p className="mt-3 leading-relaxed">{r.notes}</p>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
