import { NextResponse } from "next/server";
import { redact } from "@/lib/pii";
import { logEvent, one, query } from "@/lib/db";

const DECISIONS = ["pending", "invite", "reject", "hold"];

// Arjun's edits: contact details, decision, and notes (his record of reasoning).
export async function PATCH(request: Request, ctx: RouteContext<"/api/candidates/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json();
  const update: Record<string, unknown> = {};

  for (const field of ["full_name", "email", "phone", "arjun_notes"] as const) {
    if (typeof body[field] === "string") update[field] = body[field].trim() || null;
  }
  if (typeof body.decision === "string") {
    if (!DECISIONS.includes(body.decision)) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    update.decision = body.decision;
  }
  if (typeof update.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address" }, { status: 400 });
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // A corrected name/email/phone must also be scrubbed from the stored text before any re-run.
  if (update.full_name || update.email || update.phone) {
    const cur = await one<{ redacted_text: string | null }>("select redacted_text from kargo_candidates where id = $1", [id]);
    if (cur?.redacted_text) {
      update.redacted_text = redact(cur.redacted_text, {
        full_name: (update.full_name as string) ?? null,
        email: (update.email as string) ?? null,
        phone: (update.phone as string) ?? null,
      });
    }
  }

  // Column names come only from the whitelist above; values are bound parameters.
  const cols = Object.keys(update);
  await query(`update kargo_candidates set ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [
    id,
    ...cols.map((k) => update[k]),
  ]);

  const changed = Object.keys(update).filter((k) => k !== "redacted_text");
  await logEvent(id, "arjun", "updated", {
    fields: changed,
    ...(update.decision ? { decision: update.decision } : {}),
    ...(update.arjun_notes !== undefined ? { notes: update.arjun_notes } : {}),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/candidates/[id]">) {
  const { id } = await ctx.params;
  // Cascades to scores, brief, email, events and the stored CV file.
  await query("delete from kargo_candidates where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
