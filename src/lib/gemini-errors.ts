// Pure helpers for the Gemini client: which failures are worth retrying, how long to wait,
// and how to turn Google's error JSON into a message Arjun can act on.

export const MAX_ATTEMPTS = 8;
// Overloaded attempts on one model before moving to the next model in the chain.
export const OVERLOADS_BEFORE_SWITCH = 3;

type ListedModel = { name?: string; supportedGenerationMethods?: string[] };

// From Google's models.list response, the Flash text models that support generateContent,
// best first: stable before preview/experimental, then newest version, then "-latest" aliases.
export function rankFlashModels(models: ListedModel[], exclude: string[] = []): string[] {
  const skip = new Set(exclude);
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => String(m.name ?? "").replace(/^models\//, ""))
    .filter((n) => /flash/i.test(n) && !/(image|tts|audio|live|embedding|vision|8b)/i.test(n) && !skip.has(n));
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const unstable = (n: string) => (/(preview|exp)/i.test(n) ? 1 : 0);
  const alias = (n: string) => (/latest/i.test(n) ? 1 : 0);
  return [...new Set(names)].sort(
    (a, b) => unstable(a) - unstable(b) || version(b) - version(a) || alias(a) - alias(b) || a.localeCompare(b),
  );
}

export function isRetryable(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// Exponential backoff (2s, 4s, 8s, then 10s each) with jitter, or Google's Retry-After when given.
// Kept short so four sequential AI steps fit inside the 300s function limit.
export function backoffMs(attempt: number, retryAfterHeader?: string | null, random = Math.random) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 15) * 1000;
  const base = Math.min(2000 * 2 ** (attempt - 1), 10000);
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
      return `Gemini model "${model}" is not available to this key (404). It was skipped; no other Flash model this key can use is working right now.`;
    default:
      return `Gemini ${status}: ${detail || "request failed"}`;
  }
}
