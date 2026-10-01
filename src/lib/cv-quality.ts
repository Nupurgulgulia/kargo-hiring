// Is the text extracted from a CV fit to score? PDFs with broken fonts or overlapping text layers
// extract as garbage (doubled letters, text split into single letters, words run together, unmapped
// glyphs). Scoring that would be scoring noise, so these are flagged instead. Pure and unit-tested.

// Word exports bullets from its Symbol/Wingdings fonts as private-use characters. They are just bullets.
export const BULLET_PUA = /[\uF0A7\uF0B7\uF0D8\uF076\uF0FC\uF06E\uF0A8\uF09F]/g;

export type QualityReport = {
  ok: boolean;
  reasons: string[];
  stats: { words: number; doubledPct: number; vowelPct: number; singleLetterPct: number; stopwordPct: number; longTokens: number; sections: number };
};

const STOPWORDS = new Set(
  "the and of to in for with a an on at by as is was were be been are from that this their they have has had it its or not but also over into more led built managed worked work using used across within between after before during while who which what when where than then so can will our your you we i my me team teams product products customer customers business data user users system systems design develop development project projects years year months month experience education skills summary responsible delivered drove improved increased reduced".split(
    " ",
  ),
);
const SECTION = /\b(experience|education|skills|summary|profile|projects?|employment|work history|certifications?|achievements?)\b/gi;
// Symbols that normally appear in resumes (bullets, dashes, arrows, quotes, currency); anything else is "unusual".
const COMMON_SYMBOLS = /[·–—‘’“”•●○▪◦→➢✓₹ …]/;

export function assessCvText(text: string): QualityReport {
  const reasons: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  const alphaWords = words.map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

  const doubledPct = pct((text.match(/([A-Za-z])\1/g) ?? []).length, letters);
  const vowelPct = pct((text.match(/[aeiouAEIOU]/g) ?? []).length, letters);
  const singleLetterPct = pct(alphaWords.filter((w) => w.length === 1 && !/^[aAiI]$/.test(w)).length, alphaWords.length);
  const stopwordPct = pct(alphaWords.filter((w) => STOPWORDS.has(w.toLowerCase())).length, alphaWords.length);
  const longTokens = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 25).length;
  const glued = (text.match(/[a-z][A-Z][a-z]/g) ?? []).length;
  const sections = new Set((text.match(SECTION) ?? []).map((s) => s.toLowerCase())).size;
  const unmapped = (text.replace(BULLET_PUA, "\u2022").match(/[\uFFFD\uE000-\uF8FF]/g) ?? []).length;
  const unusual = [...text].filter((ch) => ch.charCodeAt(0) > 127 && !COMMON_SYMBOLS.test(ch) && !/[ऀ-ॿ]/.test(ch)).length;
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 12);
  const repeatedLines = lines.length - new Set(lines).size;

  if (words.length < 80) reasons.push(`only ${words.length} words extracted`);
  if (letters / Math.max(1, text.length) < 0.45) reasons.push("mostly non-letter characters");
  if (doubledPct > 8) reasons.push(`${doubledPct}% doubled letters (overlapping text layers)`);
  if (vowelPct < 28 || vowelPct > 48) reasons.push(`letter mix is not English-like (${vowelPct}% vowels)`);
  if (singleLetterPct > 6) reasons.push(`${singleLetterPct}% of words are single letters (text split apart)`);
  if (stopwordPct < 10) reasons.push(`only ${stopwordPct}% ordinary words`);
  if (longTokens > 4 || glued > 60) reasons.push("words run together");
  if (unmapped > 3) reasons.push(`${unmapped} unmapped glyphs`);
  if (unusual / Math.max(1, text.length) > 0.03) reasons.push("many unusual symbols");
  if (sections === 0) reasons.push("no resume sections found");
  if (lines.length >= 10 && repeatedLines / lines.length > 0.3) reasons.push("many repeated lines");

  return { ok: reasons.length === 0, reasons, stats: { words: words.length, doubledPct, vowelPct, singleLetterPct, stopwordPct, longTokens, sections } };
}
