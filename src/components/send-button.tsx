"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EmailKind } from "@/lib/types";
import { buttonClass } from "./ui";

// The one-click send Arjun controls. Opens a confirmation showing exactly who receives what;
// only the confirm button calls the send endpoint.
export function SendButton({
  candidateId,
  kind,
  to,
  subject,
  disabledReason,
  small = false,
  onBeforeSend,
  testRecipient = null,
}: {
  candidateId: string;
  kind: EmailKind;
  to: string | null;
  subject?: string;
  disabledReason?: string | null;
  small?: boolean;
  onBeforeSend?: () => Promise<boolean>;
  testRecipient?: string | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = disabledReason ?? (!to && !testRecipient ? "Add an email address first" : null);

  useEffect(() => {
    const d = dialogRef.current;
    const onClose = () => setError(null);
    d?.addEventListener("close", onClose);
    return () => d?.removeEventListener("close", onClose);
  }, []);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (onBeforeSend && !(await onBeforeSend())) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/candidates/${candidateId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Send failed");
      dialogRef.current?.close();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = testRecipient
    ? kind === "invite" ? "Test-send invite" : "Test-send rejection"
    : kind === "invite" ? "Send invite" : "Send rejection";
  return (
    <>
      <button
        type="button"
        className={small ? `${buttonClass.secondary} px-2.5 py-1 text-xs` : buttonClass.primary}
        disabled={Boolean(reason)}
        title={reason ?? undefined}
        onClick={() => dialogRef.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <div className="p-5">
          <h3 className="font-semibold">
            {testRecipient ? "Test-send " : "Send "}
            {kind === "invite" ? "interview invite?" : "rejection?"}
          </h3>
          {testRecipient ? (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              Test mode: this goes to {testRecipient}, not the candidate. The draft stays unsent.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">This sends the email now via Resend. It can&apos;t be unsent.</p>
          )}
          <dl className="mt-4 space-y-1.5 rounded-lg bg-surface-2 p-3 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">To</dt>
              <dd className="min-w-0 break-all font-medium">{testRecipient ?? to}</dd>
            </div>
            {testRecipient && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted">Instead of</dt>
                <dd className="min-w-0 break-all text-muted line-through">{to ?? "no email on file"}</dd>
              </div>
            )}
            {subject && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted">Subject</dt>
                <dd className="min-w-0">{subject}</dd>
              </div>
            )}
          </dl>
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => dialogRef.current?.close()} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={buttonClass.primary} onClick={send} disabled={busy}>
              {busy ? "Sending…" : label}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
