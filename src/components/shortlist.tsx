"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ListRow } from "@/lib/queries";
import type { Role } from "@/lib/types";
import { SendButton } from "./send-button";
import { Badge, Card, CardHeader, ScoreBar } from "./ui";

type Filter = "all" | "PM" | "SPM" | "todo";
type Sort = "applied" | "pm" | "spm" | "newest";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "PM", label: "PM applicants" },
  { key: "SPM", label: "SPM applicants" },
  { key: "todo", label: "Needs your action" },
];

export function Shortlist({ rows, thresholds }: { rows: ListRow[]; thresholds: Record<Role, number> }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("applied");

  // Keep the list live while any CV is still being scored.
  const processing = rows.some((r) => r.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [processing, router]);

  const visible = useMemo(() => {
    const f = rows.filter((r) => {
      if (filter === "PM" || filter === "SPM") return r.applied_role === filter;
      if (filter === "todo") return r.status === "ready" && r.email_status !== "sent";
      return true;
    });
    const key = (r: ListRow) =>
      sort === "pm" ? r.pm_score : sort === "spm" ? r.spm_score : sort === "applied" ? r.applied_score : null;
    return [...f].sort((a, b) => {
      if (sort === "newest") return b.created_at.localeCompare(a.created_at);
      return (key(b) ?? -1) - (key(a) ?? -1);
    });
  }, [rows, filter, sort]);

  return (
    <Card>
      <CardHeader
        title="Ranked candidates"
        sub={`Tick on each bar = strong-hire line (PM ${thresholds.PM}, SPM ${thresholds.SPM}). Ranked by score on the role applied for.`}
        aside={
          <label className="flex items-center gap-2 text-xs text-muted">
            Rank by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            >
              <option value="applied">Applied-role score</option>
              <option value="pm">PM score</option>
              <option value="spm">SPM score</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm ${
              filter === f.key ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-muted">
          {rows.length === 0 ? "No candidates yet. Upload a CV above to get started." : "Nothing matches this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="w-10 px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Candidate</th>
                <th className="px-2 py-2 font-medium">Applied</th>
                <th className="px-2 py-2 font-medium">PM score</th>
                <th className="px-2 py-2 font-medium">SPM score</th>
                <th className="px-2 py-2 font-medium">Recommendation</th>
                <th className="px-2 py-2 font-medium">Outreach</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <td className="tabular px-4 py-3 text-muted">{sort === "newest" ? "" : i + 1}</td>
                  <td className="max-w-72 px-2 py-3">
                    <Link href={`/candidates/${r.id}`} className="font-medium hover:text-accent">
                      {r.full_name ?? "Unnamed candidate"}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {r.status === "processing" ? "Scoring…" : r.status === "error" ? `Error: ${r.error}` : r.headline}
                    </p>
                  </td>
                  <td className="px-2 py-3">
                    <Badge tone="accent">{r.applied_role}</Badge>
                  </td>
                  <td className="px-2 py-3">
                    <ScoreBar compact score={r.pm_score} threshold={thresholds.PM} />
                  </td>
                  <td className="px-2 py-3">
                    <ScoreBar compact score={r.spm_score} threshold={thresholds.SPM} />
                  </td>
                  <td className="px-2 py-3">
                    {r.status === "processing" ? (
                      <Badge>Processing</Badge>
                    ) : r.status === "error" ? (
                      <Badge tone="bad">Failed</Badge>
                    ) : r.recommendation === "invite" ? (
                      <Badge tone="good">Interview</Badge>
                    ) : (
                      <Badge tone="neutral">Decline</Badge>
                    )}
                    {r.decision !== "pending" && (
                      <span className="ml-1.5 text-xs text-muted">you: {r.decision}</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {r.email_status === "sent" ? (
                      <Badge tone="good">{r.email_kind === "invite" ? "Invite sent" : "Rejection sent"}</Badge>
                    ) : r.email_status === "failed" ? (
                      <Badge tone="bad">Send failed</Badge>
                    ) : r.email_status ? (
                      <Badge tone="warn">{r.email_kind === "invite" ? "Invite drafted" : "Rejection drafted"}</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {r.email_kind && (r.email_status === "draft" || r.email_status === "failed") && (
                        <SendButton small candidateId={r.id} kind={r.email_kind} to={r.email} />
                      )}
                      <Link href={`/candidates/${r.id}`} className="whitespace-nowrap text-xs font-medium text-accent hover:underline">
                        Review →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
