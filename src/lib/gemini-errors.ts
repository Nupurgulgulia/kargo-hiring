// Pure helpers for the Gemini client: which failures are worth retrying, how long to wait,
// and how to turn Google's error JSON into a message Arjun can act on.

// Time budget for one AI call across all retries and model switches. Five sequential steps
// (extraction, PM score, SPM score, brief, email) must fit inside the 300s function limit, with room
// left for the optional founder's read (two attempts of FOUNDER_BUDGET_MS).
export const CALL_BUDGET_MS = 48_000;
export const FOUNDER_BUDGET_MS = 25_000;
// Safety cap on requests per AI call, whatever the budget.
export const MAX_ATTEMPTS = 12;
// Overloaded (5xx) attempts on one model before moving on. Quota errors (429) move on at once.
export const OVERLOADS_BEFORE_SWITCH = 2;

type ListedModel = { name?: string; supportedGenerationMethods?: string[] };

// From Google's models.list response, the Flash text models that support generateContent,
// best first: stable before preview/experimental, full Flash before Flash-Lite, newest version
// first, then "-latest" aliases.
export function rankFlashModels(models: ListedModel[], exclude: string[] = []): string[] {
  const skip = new Set(exclude);
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => String(m.name ?? "").replace(/^models\//, ""))
    .filter((n) => /flash/i.test(n) && !/(image|tts|audio|live|embedding|vision|8b)/i.test(n) && !skip.has(n));
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const unstable = (n: string) => (/(preview|exp)/i.test(n) ? 1 : 0);
  const lite = (n: string) => (/lite/i.test(n) ? 1 : 0);
  const alias = (n: string) => (/latest/i.test(n) ? 1 : 0);
  return [...new Set(names)].sort(
    (a, b) =>
      unstable(a) - unstable(b) ||
      lite(a) - lite(b) ||
      version(b) - version(a) ||
      alias(a) - alias(b) ||
      a.localeCompare(b),
  );
}

export function isRetryable(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// Exponential backoff (2s, 4s, 8s, then 10s each) with jitter, or Google's Retry-After when given.
export function backoffMs(attempt: number, retryAfterHeader?: string | null, random = Math.random) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 15) * 1000;
  const base = Math.min(2000 * 2 ** (attempt - 1), 10000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export type QuotaInfo = {
  scope: "day" | "minute" | null; // which limit was hit, if Google says
  freeTier: boolean;
  retryDelaySec: number | null; // Google's suggested wait (RetryInfo)
};

type ErrorDetail = {
  "@type"?: string;
  reason?: string;
  retryDelay?: string;
  violations?: { quotaId?: string; quotaMetric?: string }[];
};

function parseBody(bodyText: string): { message: string; details: ErrorDetail[] } {
  try {
    const j = JSON.parse(bodyText);
    return { message: String(j?.error?.message ?? ""), details: Array.isArray(j?.error?.details) ? j.error.details : [] };
  } catch {
    return { message: bodyText.slice(0, 200), details: [] };
  }
}

export function parseQuota(bodyText: string): QuotaInfo {
  const { message, details } = parseBody(bodyText);
  const ids = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`);
  const all = `${ids.join(" ")} ${message}`;
  const scope = /per\s*day|PerDay/i.test(all) ? "day" : /per\s*minute|PerMinute/i.test(all) ? "minute" : null;
  const delay = details.find((d) => d.retryDelay)?.retryDelay;
  const retryDelaySec = delay ? Number.parseFloat(delay) : null;
  return {
    scope,
    freeTier: /free[\s_-]*tier/i.test(all),
    retryDelaySec: retryDelaySec != null && Number.isFinite(retryDelaySec) ? retryDelaySec : null,
  };
}

// Short label for the "Tried:" trail, e.g. "429 daily quota".
export function statusLabel(status: number, bodyText: string): string {
  if (status !== 429) return String(status);
  const q = parseQuota(bodyText);
  return q.scope === "day" ? "429 daily quota" : q.scope === "minute" ? "429 per-minute limit" : "429";
}

export function describeGeminiError(status: number, bodyText: string, model: string): string {
  const { message: detail, details } = parseBody(bodyText);
  const reason = String(details.find((d) => d?.reason)?.reason ?? "");
  switch (status) {
    case 503:
    case 500:
    case 502:
    case 504:
      return `Gemini is overloaded or unavailable right now (${status}). This is temporary on Google's side. Click Re-score in a few minutes.`;
    case 429: {
      const q = parseQuota(bodyText);
      const tier = q.freeTier ? "free-tier " : "";
      if (q.scope === "day") {
        return `Gemini's ${tier}daily request quota is used up on the models tried (429). It resets daily; to keep working now, enable billing on the Google AI Studio project behind GEMINI_API_KEY.`;
      }
      if (q.scope === "minute") {
        return `Gemini's ${tier}per-minute request limit was hit (429). Wait a minute, then click Re-score.`;
      }
      return `Gemini rate limit or quota reached (429). Wait a minute and click Re-score; if it keeps happening, check the quota on your Google AI Studio key.`;
    }
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
