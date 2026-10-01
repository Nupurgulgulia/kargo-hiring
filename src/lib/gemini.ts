import "server-only";
import {
  backoffMs,
  CALL_BUDGET_MS,
  describeGeminiError,
  isRetryable,
  MAX_ATTEMPTS,
  OVERLOADS_BEFORE_SWITCH,
  parseQuota,
  rankFlashModels,
  statusLabel,
} from "./gemini-errors";

// Thin client for the Gemini REST API with JSON-schema constrained output.
// Every AI step (extraction, scoring, brief, email) goes through generateJson().
//
// Model chain: GEMINI_MODEL, then GEMINI_FALLBACK_MODEL (comma-separated), then any other Flash
// models this key can use (discovered via models.list). A model is skipped on 404, left at once on a
// quota error (429) and set aside for a while, and left after repeated overloads (5xx). The model that
// last succeeded is tried first on the next call. Each call has a time budget (CALL_BUDGET_MS).

export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
const CONFIGURED_FALLBACKS = (process.env.GEMINI_FALLBACK_MODEL ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const API = "https://generativelanguage.googleapis.com/v1beta";

let workingModel: string | null = null;
const unavailable = new Set<string>();
// Models that hit a quota (429), set aside until this time so later calls skip them.
const coolingUntil = new Map<string, number>();
let discovery: Promise<{ models: string[]; failed?: string }> | null = null;

// The model that most recently produced a result, for the record stored with each AI output.
export function activeModel(): string {
  return workingModel ?? GEMINI_MODEL;
}

type Schema = Record<string, unknown>;

function discoverFlashModels(key: string): Promise<{ models: string[]; failed?: string }> {
  discovery ??= fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } })
    .then(async (res) =>
      res.ok ? { models: rankFlashModels((await res.json())?.models ?? []) } : { models: [], failed: String(res.status) },
    )
    .catch(() => ({ models: [], failed: "network error" }));
  return discovery;
}

export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  // Never quote the key in an error: a pasted key with a space or line break would otherwise
  // be echoed back by fetch as an "invalid header value".
  if (/\s/.test(key)) {
    throw new Error("GEMINI_API_KEY contains a space or line break. Re-paste it as a single line in Vercel, then redeploy.");
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
    },
  });

  const now = Date.now();
  const chain = [...new Set([workingModel, GEMINI_MODEL, ...CONFIGURED_FALLBACKS].filter((m): m is string => !!m))].filter(
    (m) => !unavailable.has(m) && !((coolingUntil.get(m) ?? 0) > now),
  );
  let discovered = false;
  let index = 0;
  let overloads = 0;
  // Which models were tried and what they returned, attached to the error if every attempt fails.
  const trail: string[] = [];
  const note = (entry: string) => {
    const last = trail.at(-1);
    const m = last?.match(/^(.*) ×(\d+)$/);
    if (last === entry) trail[trail.length - 1] = `${entry} ×2`;
    else if (m && m[1] === entry) trail[trail.length - 1] = `${entry} ×${Number(m[2]) + 1}`;
    else trail.push(entry);
  };
  const failWith = (message: string) => new Error(trail.length ? `${message} Tried: ${trail.join(", ")}.` : message);

  // Move to the next model; when the known ones run out, append what the key can actually use.
  const nextModel = async (): Promise<boolean> => {
    overloads = 0;
    if (index + 1 >= chain.length && !discovered) {
      discovered = true;
      const { models: found, failed } = await discoverFlashModels(key);
      const t = Date.now();
      chain.push(...found.filter((m) => !chain.includes(m) && !unavailable.has(m) && !((coolingUntil.get(m) ?? 0) > t)));
      trail.push(
        failed
          ? `[model list unavailable: ${failed}]`
          : `[key can use ${found.length} Flash model${found.length === 1 ? "" : "s"}]`,
      );
    }
    if (index + 1 < chain.length) {
      index++;
      return true;
    }
    return false;
  };

  if (!chain.length) await nextModel();
  if (!chain.length) {
    throw new Error("Every Gemini Flash model this key can use is out of quota or unavailable right now. Try again later.");
  }

  const deadline = Date.now() + CALL_BUDGET_MS;
  let lastError = "";
  let quotaError = ""; // a 429 explains more than a trailing 503, so it wins in the final message
  let wait = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (wait) {
      if (Date.now() + wait > deadline) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    const model = chain[index];
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
    });

    if (res.status === 404) {
      note(`${model} 404`);
      lastError = describeGeminiError(404, await res.text(), model);
      unavailable.add(model);
      if (workingModel === model) workingModel = null;
      wait = 0;
      if (await nextModel()) continue;
      break;
    }
    if (res.status === 429) {
      // Quotas are per model: set this one aside and try another straight away.
      const text = await res.text();
      note(`${model} ${statusLabel(429, text)}`);
      quotaError = lastError = describeGeminiError(429, text, model);
      const q = parseQuota(text);
      coolingUntil.set(model, Date.now() + (q.scope === "day" ? 60 * 60_000 : Math.max(q.retryDelaySec ?? 60, 30) * 1000));
      if (workingModel === model) workingModel = null;
      if (await nextModel()) {
        wait = 500;
        continue;
      }
      break;
    }
    if (isRetryable(res.status)) {
      note(`${model} ${res.status}`);
      lastError = describeGeminiError(res.status, await res.text(), model);
      wait = backoffMs(attempt + 1, res.headers.get("retry-after"));
      // A different model needs no long cool-down.
      if (++overloads >= OVERLOADS_BEFORE_SWITCH && (await nextModel())) wait = 1000;
      continue;
    }
    if (!res.ok) {
      note(`${model} ${res.status}`);
      throw failWith(describeGeminiError(res.status, await res.text(), model));
    }

    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (!text) {
      lastError = `Gemini returned no content (finishReason: ${json?.candidates?.[0]?.finishReason ?? "unknown"})`;
      wait = 1000;
      continue;
    }
    try {
      const parsed = JSON.parse(text) as T;
      workingModel = model;
      return parsed;
    } catch {
      lastError = "Gemini returned invalid JSON";
      wait = 1000;
    }
  }
  throw failWith(quotaError || lastError || "Gemini request failed");
}
