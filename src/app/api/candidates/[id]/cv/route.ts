import { NextResponse } from "next/server";
import { CV_BUCKET, db } from "@/lib/supabase";

// Short-lived signed link to the original CV in the private bucket.
export async function GET(_request: Request, ctx: RouteContext<"/api/candidates/[id]/cv">) {
  const { id } = await ctx.params;
  const { data } = await db().from("kargo_candidates").select("cv_storage_path").eq("id", id).maybeSingle();
  if (!data?.cv_storage_path) return NextResponse.json({ error: "No CV file stored" }, { status: 404 });
  const { data: signed, error } = await db().storage.from(CV_BUCKET).createSignedUrl(data.cv_storage_path, 120);
  if (error || !signed) return NextResponse.json({ error: error?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
