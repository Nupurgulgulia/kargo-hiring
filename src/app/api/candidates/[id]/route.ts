import { NextResponse } from "next/server";
import { redact } from "@/lib/pii";
import { CV_BUCKET, db, logEvent } from "@/lib/supabase";

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
    const { data: cur } = await db().from("kargo_candidates").select("redacted_text").eq("id", id).single();
    if (cur?.redacted_text) {
      update.redacted_text = redact(cur.redacted_text, {
        full_name: (update.full_name as string) ?? null,
        email: (update.email as string) ?? null,
        phone: (update.phone as string) ?? null,
      });
    }
  }

  const { error } = await db().from("kargo_candidates").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  const { data } = await db().from("kargo_candidates").select("cv_storage_path").eq("id", id).maybeSingle();
  if (data?.cv_storage_path) await db().storage.from(CV_BUCKET).remove([data.cv_storage_path]);
  const { error } = await db().from("kargo_candidates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
