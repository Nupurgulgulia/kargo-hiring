import { connection } from "next/server";
import { Shortlist } from "@/components/shortlist";
import { Uploader } from "@/components/uploader";
import { autoSendRejectionsEnabled } from "@/lib/auto-send";
import { getRubrics } from "@/lib/db";
import { testRecipient } from "@/lib/email";
import { listCandidates } from "@/lib/queries";
import { emailStats } from "@/lib/stats";

export default async function DashboardPage() {
  await connection();
  const [rows, rubrics] = await Promise.all([listCandidates(), getRubrics()]);
  const testTo = testRecipient();
  const autoReject = autoSendRejectionsEnabled();

  const ready = rows.filter((r) => r.status === "ready");
  const mail = emailStats(rows, Boolean(testTo));
  const stats: { label: string; value: number; hint?: string }[] = [
    { label: "Candidates", value: rows.length },
    { label: "Recommended to interview", value: ready.filter((r) => r.recommendation === "invite").length },
    { label: "Awaiting your send", value: mail.awaitingYourSend, hint: "drafts not yet sent to a candidate" },
    { label: "Emails sent", value: mail.emailsSent },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
        <p className="mt-1 text-sm text-muted">
          Every CV is scored on both the PM and SPM rubrics.{" "}
          {autoReject
            ? "Rejections are emailed automatically once scoring finishes; invites are only sent when you click Send."
            : "Drafts are never sent until you click Send."}
        </p>
      </div>

      <dl className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))" }}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className="tabular mt-1 text-2xl font-semibold">{s.value}</dd>
            {s.hint && <p className="mt-0.5 truncate text-xs text-muted">{s.hint}</p>}
          </div>
        ))}
      </dl>

      <Uploader />

      <Shortlist
        rows={rows}
        thresholds={{ PM: rubrics.PM.threshold, SPM: rubrics.SPM.threshold }}
        testRecipient={testTo}
      />
    </div>
  );
}
