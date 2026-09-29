import { NextResponse } from "next/server";
import { sendCandidateEmail } from "@/lib/email";
import { errorMessage } from "@/lib/secrets";

// The ONLY path that sends email. Reached solely from the Send button (with confirmation)
// on the dashboard; there is no automatic or scheduled caller.
export async function POST(request: Request, ctx: RouteContext<"/api/candidates/[id]/send">) {
  const { id } = await ctx.params;
  const { confirm } = await request.json().catch(() => ({}));
  if (confirm !== true) {
    return NextResponse.json({ error: "Send must be explicitly confirmed" }, { status: 400 });
  }
  try {
    const result = await sendCandidateEmail(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
