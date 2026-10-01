import { NextResponse } from "next/server";
import { logEvent } from "@/lib/db";
import { writeFoundersRead } from "@/lib/founder";
import { errorMessage } from "@/lib/secrets";

export const maxDuration = 90;

// Writes (or rewrites) the founder's read for one candidate. This is the only thing it does: it
// does not re-score, change the recommendation, touch the draft or send anything, so it is safe
// for candidates scored before this feature existed.
export async function POST(_request: Request, ctx: RouteContext<"/api/candidates/[id]/founders-read">) {
  const { id } = await ctx.params;
  try {
    await logEvent(id, "arjun", "founders_read_requested");
    await writeFoundersRead(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = errorMessage(e);
    await logEvent(id, "system", "founders_read_failed", { error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
