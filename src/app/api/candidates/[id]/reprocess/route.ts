import { after, NextResponse } from "next/server";
import { processCandidate } from "@/lib/pipeline";
import { logEvent, one, query } from "@/lib/db";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/candidates/[id]/reprocess">) {
  const { id } = await ctx.params;
  const email = await one<{ status: string }>("select status from kargo_emails where candidate_id = $1", [id]);
  if (email?.status === "sent" || email?.status === "sending") {
    return NextResponse.json({ error: "Email already sent; re-scoring would overwrite the record of what was sent." }, { status: 409 });
  }
  const updated = await query("update kargo_candidates set status = 'processing', error = null where id = $1 returning id", [id]);
  if (!updated.length) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  await logEvent(id, "arjun", "reprocess_requested");
  after(() => processCandidate(id));
  return NextResponse.json({ ok: true });
}
