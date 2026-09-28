import { NextResponse } from "next/server";
import { redraftEmail } from "@/lib/pipeline";
import { db, logEvent } from "@/lib/supabase";

export const maxDuration = 60;

// Save Arjun's edits to the draft. Never sends.
export async function PUT(request: Request, ctx: RouteContext<"/api/candidates/[id]/email">) {
  const { id } = await ctx.params;
  const { subject, body } = await request.json();
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return NextResponse.json({ error: "Subject and body are required" }, { status: 400 });
  }
  const { data, error } = await db()
    .from("kargo_emails")
    .update({ subject, body, updated_at: new Date().toISOString() })
    .eq("candidate_id", id)
    .in("status", ["draft", "failed"])
    .select("candidate_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Draft can't be edited after sending" }, { status: 409 });
  await logEvent(id, "arjun", "email_edited");
  return NextResponse.json({ ok: true });
}

// Regenerate the draft as a different type (Arjun overriding the recommendation). Never sends.
export async function POST(request: Request, ctx: RouteContext<"/api/candidates/[id]/email">) {
  const { id } = await ctx.params;
  const { kind } = await request.json();
  if (kind !== "invite" && kind !== "reject") {
    return NextResponse.json({ error: "kind must be invite or reject" }, { status: 400 });
  }
  try {
    await logEvent(id, "arjun", "redraft_requested", { kind });
    await redraftEmail(id, kind);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
