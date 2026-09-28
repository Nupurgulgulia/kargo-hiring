import { NextResponse } from "next/server";
import { one } from "@/lib/db";

// Streams the original CV from kargo_cv_files. Protected by the dashboard session (proxy.ts).
export async function GET(_request: Request, ctx: RouteContext<"/api/candidates/[id]/cv">) {
  const { id } = await ctx.params;
  const file = await one<{ filename: string; content_type: string; data: Buffer }>(
    "select filename, content_type, data from kargo_cv_files where candidate_id = $1",
    [id],
  );
  if (!file) return NextResponse.json({ error: "No CV file stored" }, { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.content_type,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
