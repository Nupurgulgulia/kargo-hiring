// Single-user password gate for Arjun. The session cookie holds an HMAC derived from the
// dashboard password, so rotating DASHBOARD_PASSWORD logs everyone out.
// Uses Web Crypto so it runs in both the proxy and route handlers.

export const SESSION_COOKIE = "kargo_session";

export function authConfigured() {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

export async function expectedToken(): Promise<string> {
  const secret = `${process.env.AUTH_SECRET ?? ""}:${process.env.DASHBOARD_PASSWORD ?? ""}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("kargo-dashboard-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(token: string | undefined) {
  if (!authConfigured()) return process.env.NODE_ENV !== "production";
  if (!token) return false;
  return safeEqual(token, await expectedToken());
}
