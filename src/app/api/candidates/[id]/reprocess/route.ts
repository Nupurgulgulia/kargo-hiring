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
  const prev = await one<{ status: string; has_extraction: boolean }>(
    "select status, extracted is not null as has_extraction from kargo_candidates where id = $1",
    [id],
  );
  if (!prev) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  // A failed run that got past extraction resumes from scoring; a finished one is fully redone.
  const resume = prev.status === "error" && prev.has_extraction;
  await query("update kargo_candidates set status = 'processing', error = null where id = $1", [id]);
  await logEvent(id, "arjun", "reprocess_requested", resume ? { resume: true } : undefined);
  after(() => processCandidate(id, { resume }));
  return NextResponse.json({ ok: true });
}
