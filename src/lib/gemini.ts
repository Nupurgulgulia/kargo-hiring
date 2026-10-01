import "server-only";
import { backoffMs, describeGeminiError, isRetryable, MAX_ATTEMPTS } from "./gemini-errors";

// Thin client for the Gemini REST API with JSON-schema constrained output.
// Every AI step (extraction, scoring, brief, email) goes through generateJson().
// Overload and rate-limit errors are retried with backoff for roughly a minute.

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL?.trim() || null;

type Schema = Record<string, unknown>;

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

  let lastError = "";
  let wait = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    // After repeated overloads, switch to GEMINI_FALLBACK_MODEL if one is configured.
    const model = FALLBACK_MODEL && attempt >= 3 ? FALLBACK_MODEL : GEMINI_MODEL;
    const res = await fetch(ENDPOINT(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (isRetryable(res.status)) {
      lastError = describeGeminiError(res.status, await res.text(), model);
      wait = backoffMs(attempt + 1, res.headers.get("retry-after"));
      continue;
    }
    if (!res.ok) {
      throw new Error(describeGeminiError(res.status, await res.text(), model));
    }
    wait = 0;
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
      return JSON.parse(text) as T;
    } catch {
      lastError = "Gemini returned invalid JSON";
      wait = 1000;
    }
  }
  throw new Error(lastError || "Gemini request failed");
}
