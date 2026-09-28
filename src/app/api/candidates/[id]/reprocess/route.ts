import { after, NextResponse } from "next/server";
import { processCandidate } from "@/lib/pipeline";
import { db, logEvent } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/candidates/[id]/reprocess">) {
  const { id } = await ctx.params;
  const { data: email } = await db().from("kargo_emails").select("status").eq("candidate_id", id).maybeSingle();
  if (email?.status === "sent" || email?.status === "sending") {
    return NextResponse.json({ error: "Email already sent; re-scoring would overwrite the record of what was sent." }, { status: 409 });
  }
  const { error } = await db().from("kargo_candidates").update({ status: "processing", error: null }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(id, "arjun", "reprocess_requested");
  after(() => processCandidate(id));
  return NextResponse.json({ ok: true });
}
