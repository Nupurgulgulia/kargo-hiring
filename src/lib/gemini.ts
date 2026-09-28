import "server-only";

// Thin client for the Gemini REST API with JSON-schema constrained output.
// Every AI step (extraction, scoring, brief, email) goes through generateJson().

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

type Schema = Record<string, unknown>;

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

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
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    const res = await fetch(ENDPOINT(GEMINI_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (res.status === 429 || res.status >= 500) {
      lastError = `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`;
      continue;
    }
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const json = await res.json();
    const text: string | undefined = json?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (!text) {
      lastError = `Gemini returned no content (finishReason: ${json?.candidates?.[0]?.finishReason ?? "unknown"})`;
      continue;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      lastError = "Gemini returned invalid JSON";
    }
  }
  throw new Error(lastError || "Gemini request failed");
}
