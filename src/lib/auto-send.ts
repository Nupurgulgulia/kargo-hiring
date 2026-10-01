import type { Decision, EmailKind } from "./types";

// Rejections can be emailed automatically when scoring finishes (AUTO_SEND_REJECTIONS=true).
// Invites never are: those wait for Arjun's click. Kept free of server-only imports so it can be
// unit-tested and used by the layout, the pipeline and the dashboard alike.

export function autoSendRejectionsEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.AUTO_SEND_REJECTIONS?.trim() ?? "");
}

export type AutoSendCheck = { send: true } | { send: false; reason: string };

export function shouldAutoSend(input: {
  enabled: boolean;
  recommendation: EmailKind | null;
  draftKind: EmailKind | null;
  decision: Decision;
}): AutoSendCheck {
  if (!input.enabled) return { send: false, reason: "automatic rejections are off" };
  if (input.recommendation !== "reject") return { send: false, reason: "not a rejection" };
  // Arjun may have switched the draft to an invite; never auto-send that.
  if (input.draftKind !== "reject") return { send: false, reason: "the draft is not a rejection" };
  // If Arjun already marked the candidate (interview / hold / decline), his call stands.
  if (input.decision !== "pending") return { send: false, reason: `you already marked this candidate "${input.decision}"` };
  return { send: true };
}
