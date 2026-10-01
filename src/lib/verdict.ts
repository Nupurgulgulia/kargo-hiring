// Shared definition of "verdict language": phrasing that turns evidence into a decision. The AI
// outputs that sit beside the score (the interview brief, the founder's read) present evidence
// and leave the decision to Arjun. Pure, so it is unit-tested and usable anywhere.

// Instructions to act: hire / reject / interview / pass / advance, said to or about Arjun.
export const VERDICT_BASE: RegExp[] = [
  /\b(?:should|must|need(?:s)? to|ought to|have to)\s+(?:definitely\s+)?(?:hire|reject|pass on|decline|interview|move forward|invite|fast[- ]track|advance)\b/i,
  /\b(?:i(?:'d| would| will|'ll)|we(?:'d| would| will|'ll))\s+(?:definitely\s+)?(?:hire|reject|pass on|decline|interview|move forward with|invite|fast[- ]track|advance)\b/i,
  /\b(?:hire|reject|pass on|decline|interview|invite|advance)\s+(?:this candidate|them|this one)\b/i,
  /\b(?:no[- ]hire|strong hire|must[- ]hire|auto[- ]?(?:hire|reject)|easy (?:hire|reject|pass))\b/i,
  /\b(?:recommend\w*|verdict|final call is)\b/i,
];

// Conclusions stated as fact: "a strong fit", "will thrive", "Arjun should ...". Used for the
// interview brief, which should lay out evidence and scores instead of concluding.
export const CONCLUSION: RegExp[] = [
  /\bArjun\s+(?:should|must|needs? to|ought to|has to|will want to)\b/i,
  /\b(?:strong|great|good|excellent|perfect|ideal|outstanding|exceptional|poor|weak|bad|clear|natural|obvious|solid)\s+(?:fit|match|candidate|hire|choice|contender)\b/i,
  /\b(?:is|are|seems|looks|appears)\s+(?:very\s+|well[- ]|a\s+)?(?:suited|unsuited)\b/i,
  /\bwell[- ]suited\b/i,
  /\b(?:no[- ]brainer|slam[- ]dunk|worth (?:hiring|interviewing|pursuing))\b/i,
  /\bshould be (?:hired|rejected|interviewed|advanced|declined|passed)\b/i,
  /\bwill (?:\w+ )?(?:compound|thrive|excel|flourish|succeed|struggle|fail)\b/i,
];

export function findVerdicts(text: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((re) => {
    const m = text.match(re);
    return m ? [m[0]] : [];
  });
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

// Drops every sentence that contains a verdict phrase and returns what was removed.
export function scrubSentences(text: string, patterns: RegExp[]): { text: string; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of splitSentences(text)) (findVerdicts(s, patterns).length ? removed : kept).push(s);
  return { text: kept.join(" "), removed };
}
