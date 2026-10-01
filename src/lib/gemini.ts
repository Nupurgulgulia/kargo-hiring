import "server-only";
import {
  backoffMs,
  describeGeminiError,
  isRetryable,
  MAX_ATTEMPTS,
  OVERLOADS_BEFORE_SWITCH,
  rankFlashModels,
} from "./gemini-errors";

// Thin client for the Gemini REST API with JSON-schema constrained output.
// Every AI step (extraction, scoring, brief, email) goes through generateJson().
//
// Model chain: GEMINI_MODEL, then GEMINI_FALLBACK_MODEL (comma-separated), then any other Flash
// models this key can use (discovered via models.list). A model is skipped on 404, and left after
// repeated overloads. The model that last succeeded is tried first on the next call.

export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
const CONFIGURED_FALLBACKS = (process.env.GEMINI_FALLBACK_MODEL ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const API = "https://generativelanguage.googleapis.com/v1beta";

let workingModel: string | null = null;
const unavailable = new Set<string>();
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

  const chain = [...new Set([workingModel, GEMINI_MODEL, ...CONFIGURED_FALLBACKS].filter((m): m is string => !!m))].filter(
    (m) => !unavailable.has(m),
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
      chain.push(...found.filter((m) => !chain.includes(m) && !unavailable.has(m)));
      trail.push(
        failed
          ? `[model list unavailable: ${failed}]`
          : `[key can use ${found.length} Flash model${found.length === 1 ? "" : "s"}: ${found.join(" / ") || "none"}]`,
      );
    }
    if (index + 1 < chain.length) {
      index++;
      return true;
    }
    return false;
  };

  if (!chain.length) await nextModel();
  if (!chain.length) throw new Error("No Gemini Flash model is available to this API key.");

  let lastError = "";
  let wait = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
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
      throw failWith(lastError);
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
  throw failWith(lastError || "Gemini request failed");
}
