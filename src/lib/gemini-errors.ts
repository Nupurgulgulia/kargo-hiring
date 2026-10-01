// Pure helpers for the Gemini client: which failures are worth retrying, how long to wait,
// and how to turn Google's error JSON into a message Arjun can act on.

export const MAX_ATTEMPTS = 6;

export function isRetryable(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// Exponential backoff (2s, 4s, 8s, 16s, 20s…) with jitter, or Google's Retry-After when given.
export function backoffMs(attempt: number, retryAfterHeader?: string | null, random = Math.random) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
  const base = Math.min(2000 * 2 ** (attempt - 1), 20000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export function describeGeminiError(status: number, bodyText: string, model: string): string {
  let detail = "";
  let reason = "";
  try {
    const j = JSON.parse(bodyText);
    detail = String(j?.error?.message ?? "");
    reason = String(j?.error?.details?.find((d: { reason?: string }) => d?.reason)?.reason ?? "");
  } catch {
    detail = bodyText.slice(0, 200);
  }
  switch (status) {
    case 503:
    case 500:
    case 502:
    case 504:
      return `Gemini is overloaded or unavailable right now (${status}). This is temporary on Google's side. Click Re-score in a few minutes.`;
    case 429:
      return `Gemini rate limit or quota reached (429). Wait a minute and click Re-score; if it keeps happening, check the quota on your Google AI Studio key.`;
    case 400:
      if (/API key/i.test(detail)) return `Gemini rejected the API key (400: ${detail}). Check GEMINI_API_KEY in Vercel.`;
      return `Gemini rejected the request (400): ${detail}`;
    case 401:
    case 403:
      return `Gemini rejected the API key (${status}${reason ? `: ${reason}` : ""}). Use a Gemini API key from Google AI Studio in GEMINI_API_KEY, then redeploy.`;
    case 404:
      return `Gemini model "${model}" is not available to this key (404). Set GEMINI_MODEL to a current Flash model.`;
    default:
      return `Gemini ${status}: ${detail || "request failed"}`;
  }
}
