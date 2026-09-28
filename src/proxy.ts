import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
