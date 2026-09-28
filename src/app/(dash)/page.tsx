import { connection } from "next/server";
import { Shortlist } from "@/components/shortlist";
import { Uploader } from "@/components/uploader";
import { listCandidates } from "@/lib/queries";
import { getRubrics } from "@/lib/db";

export default async function DashboardPage() {
  await connection();
  const [rows, rubrics] = await Promise.all([listCandidates(), getRubrics()]);

  const ready = rows.filter((r) => r.status === "ready");
  const stats = [
    { label: "Candidates", value: rows.length },
    { label: "Recommended to interview", value: ready.filter((r) => r.recommendation === "invite").length },
    { label: "Drafts awaiting your send", value: rows.filter((r) => r.email_status === "draft" || r.email_status === "failed").length },
    { label: "Emails sent", value: rows.filter((r) => r.email_status === "sent").length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
        <p className="mt-1 text-sm text-muted">
          Every CV is scored on both the PM and SPM rubrics. Drafts are never sent until you click Send.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className="tabular mt-1 text-2xl font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <Uploader />

      <Shortlist rows={rows} thresholds={{ PM: rubrics.PM.threshold, SPM: rubrics.SPM.threshold }} />
    </div>
  );
}
