// Deterministic PII detection and redaction. This runs before any AI call: name, email and
// phone are pulled out into their own database columns and scrubbed from the CV text, so the
// LLM only ever sees the redacted text.

export type Contact = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Candidate phone-like runs; filtered to 10–15 digits below so date ranges and years survive.
const PHONE_RE = /(?:\+?\d[\d\s().\-]{7,}\d)/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com|behance\.net|medium\.com)\/\S+/gi;

const HEADER_WORDS =
  /\b(resume|résumé|curriculum|vitae|cv|profile|summary|contact|objective|experience|education|skills|product|manager|senior|mumbai|india|bangalore|bengaluru|delhi|pune)\b/i;

function digitCount(s: string) {
  return (s.match(/\d/g) ?? []).length;
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function guessName(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/[|•·,]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const line of lines) {
    const candidate = line.replace(/^name\s*[:\-]\s*/i, "");
    if (candidate.length > 50 || /[@\d]/.test(candidate) || HEADER_WORDS.test(candidate)) continue;
    const words = candidate.split(" ");
    if (words.length < 2 || words.length > 4) continue;
    if (words.every((w) => /^[A-Z][A-Za-z.'\-]*$/.test(w))) return titleCase(candidate);
  }
  return null;
}

export function detectContact(text: string): Contact {
  const email = text.match(EMAIL_RE)?.[0] ?? null;
  const phone =
    (text.match(PHONE_RE) ?? []).map((p) => p.trim()).find((p) => {
      const d = digitCount(p);
      return d >= 10 && d <= 15;
    }) ?? null;
  return { full_name: guessName(text), email, phone };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTokens(fullName: string | null): string[] {
  if (!fullName) return [];
  return fullName
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z'\-]/g, ""))
    .filter((t) => t.length >= 2);
}

export function redact(text: string, contact: Contact): string {
  let out = text.replace(EMAIL_RE, "[EMAIL]").replace(URL_RE, "[URL]");
  out = out.replace(PHONE_RE, (m) => {
    const d = digitCount(m);
    return d >= 10 && d <= 15 ? "[PHONE]" : m;
  });
  if (contact.full_name) {
    out = out.replace(new RegExp(escapeRe(contact.full_name), "gi"), "[CANDIDATE]");
    for (const token of nameTokens(contact.full_name)) {
      out = out.replace(new RegExp(`\\b${escapeRe(token)}\\b`, "gi"), "[CANDIDATE]");
    }
    out = out.replace(/(\[CANDIDATE\]\s*){2,}/g, "[CANDIDATE] ");
  }
  return out;
}

// Last line of defence before anything goes to the LLM: refuse to send if any known PII
// value is still present in the payload.
export function assertNoPII(payload: string, contact: Contact) {
  const lower = payload.toLowerCase();
  if (contact.email && lower.includes(contact.email.toLowerCase())) {
    throw new Error("PII guard: email address found in AI payload");
  }
  if (contact.phone) {
    const digits = contact.phone.replace(/\D/g, "");
    const runs = [...(payload.match(PHONE_RE) ?? []), ...(payload.match(/\d{10,}/g) ?? [])];
    if (digits.length >= 10 && runs.some((r) => r.replace(/\D/g, "").includes(digits.slice(-10)))) {
      throw new Error("PII guard: phone number found in AI payload");
    }
  }
  for (const token of nameTokens(contact.full_name)) {
    if (new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(payload)) {
      throw new Error("PII guard: candidate name found in AI payload");
    }
  }
}

export function firstName(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] ?? "";
}
