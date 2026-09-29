// Error messages from third-party libraries can echo request details, including API keys
// (e.g. undici's "Headers.append: <value> is an invalid header value"). Everything that ends
// up in the database or on screen goes through redactSecrets() first.

const SECRET_ENV = [
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "AUTH_SECRET",
  "DASHBOARD_PASSWORD",
];

// Common credential shapes, as a backstop for values not in the env list.
const SECRET_PATTERNS = [
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /\bAQ\.[0-9A-Za-z_.-]{20,}/g, // Google bound API keys
  /\bya29\.[0-9A-Za-z_.-]{20,}/g, // Google OAuth access tokens
  /\bre_[0-9A-Za-z_]{16,}/g, // Resend API keys
  /\bnpg_[0-9A-Za-z]{8,}/g, // Neon passwords
  /postgres(?:ql)?:\/\/[^\s"']+/g, // connection strings
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(message: string): string {
  let out = message;
  for (const name of SECRET_ENV) {
    const raw = process.env[name];
    if (!raw || raw.trim().length < 6) continue;
    // The whole value as stored, and each whitespace-separated piece of it: a key pasted with a
    // stray space or line break would otherwise survive a whole-value match.
    const pieces = [raw, raw.trim(), ...raw.split(/\s+/)].filter((p) => p.length >= 6);
    for (const p of pieces) out = out.replace(new RegExp(escapeRe(p), "g"), "[REDACTED]");
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function errorMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}
