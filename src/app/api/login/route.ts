import { NextResponse } from "next/server";
import { authConfigured, expectedToken, safeEqual, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!authConfigured()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }
  if (!safeEqual(password, process.env.DASHBOARD_PASSWORD!)) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(safeNext)}`, request.url), 303);
  }
  const res = NextResponse.redirect(new URL(safeNext, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
