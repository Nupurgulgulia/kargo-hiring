// Rules for the founder's read. Pure (no server-only imports) so they can be unit-tested.
//
// The read is pattern-matching for Arjun to weigh. It must never become a verdict, never lean on
// protected attributes, and never cite a past hire who isn't one of the eight on file.

export type SignalStrength = "strong" | "some" | "absent";
export type MatchQuality = "close" | "partial" | "loose";
export type Outcome = "exceeds" | "meets" | "below";

export type FoundersRead = {
  read: string;
  match_quality: MatchQuality;
  resembles: { name: string; why: string }[];
  signals: { key: string; strength: SignalStrength; note: string }[];
  could_be_wrong: string;
};

export const READ_MIN_WORDS = 60;
export const READ_MAX_WORDS = 170;

// Phrases that turn a pattern observation into a decision.
const VERDICT = [
  /\b(?:should|must|need(?:s)? to|ought to|have to)\s+(?:definitely\s+)?(?:hire|reject|pass on|decline|interview|move forward|invite|fast[- ]track|advance)\b/i,
  /\b(?:i(?:'d| would| will|'ll)|we(?:'d| would| will|'ll))\s+(?:definitely\s+)?(?:hire|reject|pass on|decline|interview|move forward with|invite|fast[- ]track|advance)\b/i,
  /\b(?:hire|reject|pass on|decline|interview|invite|advance)\s+(?:this candidate|them|this one)\b/i,
  /\b(?:no[- ]hire|strong hire|must[- ]hire|auto[- ]?(?:hire|reject)|easy (?:hire|reject|pass))\b/i,
  /\b(?:recommend\w*|verdict|final call is)\b/i,
];

// Gendered pronouns: nobody's pronouns are known here, so the read uses names and "they".
const GENDERED = /\b(?:he|she|his|hers?|him|himself|herself)\b/i;

// Attributes the read must never reason from or mention.
const PROTECTED =
  /\b(?:gender|female|male|woman|women|man|men|married|unmarried|single mother|pregnan\w*|age[ds]?|elderly|caste|religio\w*|ethnic\w*|race|racial|nationality|accent|disabilit\w*)\b/i;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function validateFoundersRead(
  r: FoundersRead,
  ctx: { hireNames: string[]; signalKeys: string[] },
): string[] {
  const problems: string[] = [];
  const text = [r.read, r.could_be_wrong, ...r.resembles.map((x) => x.why), ...r.signals.map((x) => x.note)].join(" \n ");

  const words = wordCount(r.read);
  if (words < READ_MIN_WORDS) problems.push(`The read is ${words} words; it needs at least ${READ_MIN_WORDS}.`);
  if (words > READ_MAX_WORDS) problems.push(`The read is ${words} words; keep it under ${READ_MAX_WORDS}.`);

  if (r.resembles.length < 1 || r.resembles.length > 2) {
    problems.push("Cite one or two past hires in `resembles`.");
  }
  for (const m of r.resembles) {
    if (!ctx.hireNames.includes(m.name)) problems.push(`"${m.name}" is not one of the past hires on file.`);
    else if (!new RegExp(`\\b${m.name}\\b`).test(r.read)) problems.push(`The read must name ${m.name} in the paragraph itself.`);
  }
  if (new Set(r.resembles.map((m) => m.name)).size !== r.resembles.length) problems.push("Don't cite the same past hire twice.");

  // Any other first name from the roster mentioned in the read must also be listed.
  for (const n of ctx.hireNames) {
    if (new RegExp(`\\b${n}\\b`).test(r.read) && !r.resembles.some((m) => m.name === n)) {
      problems.push(`The read mentions ${n} but ${n} is not in \`resembles\`.`);
    }
  }

  for (const re of VERDICT) {
    const m = text.match(re);
    if (m) problems.push(`Verdict language ("${m[0]}"). Describe the pattern; leave the decision to Arjun.`);
  }
  if (GENDERED.test(text)) problems.push('Gendered pronoun found. Use names, "this candidate" or "they".');
  const prot = text.match(PROTECTED);
  if (prot) problems.push(`Protected attribute mentioned ("${prot[0]}"). Compare on work and language only.`);
  if (/\[(?:CANDIDATE|EMAIL|PHONE|URL)\]/.test(text)) problems.push("Redaction markers must not appear in the read.");

  const keys = r.signals.map((s) => s.key);
  for (const k of ctx.signalKeys) if (!keys.includes(k)) problems.push(`Missing signal "${k}".`);
  if (new Set(keys).size !== keys.length) problems.push("Each signal must appear exactly once.");
  for (const k of keys) if (!ctx.signalKeys.includes(k)) problems.push(`Unknown signal "${k}".`);

  if (!r.could_be_wrong.trim()) problems.push("`could_be_wrong` is required.");
  return problems;
}

// "Reminds me of Lavanya and Rohan" for the UI, from the validated structure.
export function resemblanceLabel(r: Pick<FoundersRead, "resembles" | "match_quality">): string {
  const names = r.resembles.map((m) => m.name);
  const joined = names.length > 1 ? `${names[0]} and ${names[1]}` : names[0] ?? "no one on file";
  const q = r.match_quality === "close" ? "a close match" : r.match_quality === "partial" ? "a partial match" : "only a loose match";
  return `${joined} (${q})`;
}

// Whether the card should say "comparing against your past hires" (the read is written right after
// scoring finishes) or show the last error. `events` are newest first.
export function foundersReadStatus(
  input: {
    status: "processing" | "ready" | "error";
    hasRead: boolean;
    events: { action: string; at: string; detail: Record<string, unknown> | null }[];
  },
  now: number = Date.now(),
): { pending: boolean; error: string | null } {
  if (input.hasRead) return { pending: false, error: null };
  const completedAt = input.events.find((e) => e.action === "pipeline_complete")?.at;
  const failure = input.events.find((e) => e.action === "founders_read_failed");
  const failedSinceCompletion = Boolean(failure && completedAt && failure.at >= completedAt);
  const pending =
    input.status === "ready" &&
    Boolean(completedAt) &&
    now - new Date(completedAt!).getTime() < 3 * 60_000 &&
    !failedSinceCompletion;
  return { pending, error: failure ? String(failure.detail?.error ?? "") || null : null };
}
