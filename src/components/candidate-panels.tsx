"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Candidate, Decision, EmailKind, EmailRow } from "@/lib/types";
import { SendButton } from "./send-button";
import { Badge, Card, CardHeader, buttonClass, inputClass } from "./ui";

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

function firstName(full: string | null) {
  return full?.trim().split(/\s+/)[0] || "there";
}

export function EmailComposer({
  candidate,
  email,
  recommendation,
  testRecipient = null,
  testSends = 0,
  autoReject = false,
}: {
  candidate: Pick<Candidate, "id" | "full_name" | "email">;
  email: EmailRow;
  recommendation: EmailKind | null;
  testRecipient?: string | null;
  testSends?: number;
  autoReject?: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [busy, setBusy] = useState<null | "save" | "redraft">(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const editable = email.status === "draft" || email.status === "failed";
  const dirty = subject !== email.subject || body !== email.body;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      await api(`/api/candidates/${candidate.id}/email`, "PUT", { subject, body });
      setMsg({ tone: "good", text: "Draft saved" });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function redraft(kind: EmailKind) {
    if (dirty && !confirm("Discard your edits and generate a new draft?")) return;
    setBusy("redraft");
    setMsg(null);
    try {
      await api(`/api/candidates/${candidate.id}/email`, "POST", { kind });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const other: EmailKind = email.kind === "invite" ? "reject" : "invite";
  const preview = (s: string) => s.replace(/\{\{\s*first_name\s*\}\}/g, firstName(candidate.full_name));

  return (
    <Card>
      <CardHeader
        title="Outreach"
        sub={
          email.status === "sent"
            ? `Sent to ${email.sent_to} on ${new Date(email.sent_at!).toLocaleString("en-IN")}`
            : testSends > 0
              ? `Test-sent ${testSends}× to ${testRecipient ?? "the test address"}. Not sent to the candidate yet.`
              : autoReject && email.kind === "reject"
                ? "Rejections are emailed automatically after scoring. This one hasn't been sent; see the activity log."
                : "Draft only. Nothing is sent until you confirm."
        }
        aside={
          <div className="flex items-center gap-1.5">
            <Badge tone={email.kind === "invite" ? "good" : "neutral"}>{email.kind === "invite" ? "Invite" : "Rejection"}</Badge>
            {email.status === "sent" && <Badge tone="good">Sent</Badge>}
            {email.status === "failed" && <Badge tone="bad">Failed</Badge>}
          </div>
        }
      />
      <div className="space-y-3 p-4 sm:p-5">
        {recommendation && email.kind !== recommendation && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            You&apos;ve overridden the recommendation ({recommendation === "invite" ? "interview" : "decline"}).
          </p>
        )}
        {email.status === "failed" && email.error && (
          <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">Last send failed: {email.error}</p>
        )}
        {editable ? (
          <>
            <label className="block text-xs font-medium text-muted">
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Body <span className="font-normal">· {"{{first_name}}"} becomes “{firstName(candidate.full_name)}” when sent</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className={`${inputClass} mt-1 font-mono text-[13px] leading-relaxed`} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <SendButton
                candidateId={candidate.id}
                kind={email.kind}
                to={candidate.email}
                subject={preview(subject)}
                onBeforeSend={dirty ? save : undefined}
                testRecipient={testRecipient}
              />
              <button className={buttonClass.secondary} onClick={save} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              <button className={buttonClass.ghost} onClick={() => redraft(other)} disabled={busy !== null}>
                {busy === "redraft" ? "Drafting…" : `Redraft as ${other === "invite" ? "invite" : "rejection"}`}
              </button>
            </div>
            {!candidate.email && !testRecipient && <p className="text-xs text-warn">No email on file. Add one under Contact details to send.</p>}
          </>
        ) : (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="font-medium">{preview(email.subject)}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{preview(email.body)}</pre>
          </div>
        )}
        {msg && <p className={`text-xs ${msg.tone === "good" ? "text-good" : "text-bad"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}

const DECISION_OPTIONS: { value: Decision; label: string }[] = [
  { value: "pending", label: "Undecided" },
  { value: "invite", label: "Interview" },
  { value: "hold", label: "Hold" },
  { value: "reject", label: "Decline" },
];

export function DecisionNotes({ candidate }: { candidate: Pick<Candidate, "id" | "decision" | "arjun_notes"> }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>(candidate.decision);
  const [notes, setNotes] = useState(candidate.arjun_notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const dirty = decision !== candidate.decision || notes !== (candidate.arjun_notes ?? "");

  async function save() {
    setState("saving");
    try {
      await api(`/api/candidates/${candidate.id}`, "PATCH", { decision, arjun_notes: notes });
      setState("saved");
      router.refresh();
    } catch (e) {
      setState((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader title="Your decision" sub="Your reasoning is saved to this candidate's record." />
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap gap-1.5">
          {DECISION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setDecision(o.value)}
              aria-pressed={decision === o.value}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                decision === o.value ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Why? e.g. strong CHA background; probe the integration claims in the interview"
          className={inputClass}
        />
        <div className="flex items-center gap-3">
          <button className={buttonClass.secondary} onClick={save} disabled={!dirty || state === "saving"}>
            {state === "saving" ? "Saving…" : "Save"}
          </button>
          {state === "saved" && !dirty && <span className="text-xs text-good">Saved</span>}
          {state !== "idle" && state !== "saving" && state !== "saved" && <span className="text-xs text-bad">{state}</span>}
        </div>
      </div>
    </Card>
  );
}

export function ContactEditor({ candidate }: { candidate: Pick<Candidate, "id" | "full_name" | "email" | "phone"> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    try {
      await api(`/api/candidates/${candidate.id}`, "PATCH", {
        full_name: String(fd.get("full_name")),
        email: String(fd.get("email")),
        phone: String(fd.get("phone")),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Contact details"
        sub="Kept out of every AI step."
        aside={
          !editing && (
            <button className={buttonClass.ghost} onClick={() => setEditing(true)}>
              Edit
            </button>
          )
        }
      />
      {editing ? (
        <form onSubmit={onSubmit} className="space-y-2 p-4 sm:p-5">
          <input name="full_name" defaultValue={candidate.full_name ?? ""} placeholder="Full name" className={inputClass} />
          <input name="email" type="email" defaultValue={candidate.email ?? ""} placeholder="Email" className={inputClass} />
          <input name="phone" defaultValue={candidate.phone ?? ""} placeholder="Phone" className={inputClass} />
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button className={buttonClass.primary}>Save</button>
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="space-y-1.5 p-4 text-sm sm:p-5">
          {(
            [
              ["Name", candidate.full_name],
              ["Email", candidate.email],
              ["Phone", candidate.phone],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-14 shrink-0 text-muted">{k}</dt>
              <dd className={`min-w-0 break-all ${v ? "" : "text-warn"}`}>{v ?? "Not found"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export function CandidateActions({ id, hasCv, locked }: { id: string; hasCv: boolean; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reprocess() {
    if (!confirm("Re-run extraction, both rubric scores, the brief and the email draft? The current draft will be replaced.")) return;
    setBusy("reprocess");
    setError(null);
    try {
      await api(`/api/candidates/${id}/reprocess`, "POST");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Permanently delete this candidate, their CV file, scores, brief, draft and history?")) return;
    setBusy("delete");
    try {
      await api(`/api/candidates/${id}`, "DELETE");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {hasCv && (
        <a href={`/api/candidates/${id}/cv`} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
          Open original CV
        </a>
      )}
      <button className={buttonClass.secondary} onClick={reprocess} disabled={busy !== null || locked} title={locked ? "Email already sent" : undefined}>
        {busy === "reprocess" ? "Starting…" : "Re-score"}
      </button>
      <button className={buttonClass.danger} onClick={remove} disabled={busy !== null}>
        Delete
      </button>
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}
