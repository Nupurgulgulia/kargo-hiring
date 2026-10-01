import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backoffMs,
  CALL_BUDGET_MS,
  FOUNDER_BUDGET_MS,
  describeGeminiError,
  isRetryable,
  MAX_ATTEMPTS,
  parseQuota,
  rankFlashModels,
  statusLabel,
} from "../src/lib/gemini-errors.ts";

const OVERLOADED = JSON.stringify({
  error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" },
});
const BAD_KEY = JSON.stringify({
  error: { code: 401, status: "UNAUTHENTICATED", details: [{ reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }] },
});

test("503 overload becomes an actionable message, not raw JSON", () => {
  const msg = describeGeminiError(503, OVERLOADED, "gemini-flash-latest");
  assert.match(msg, /overloaded/);
  assert.match(msg, /Re-score in a few minutes/);
  assert.ok(!msg.includes("{"), msg);
});

test("401 names the reason and points at the key", () => {
  const msg = describeGeminiError(401, BAD_KEY, "gemini-flash-latest");
  assert.match(msg, /ACCESS_TOKEN_TYPE_UNSUPPORTED/);
  assert.match(msg, /GEMINI_API_KEY/);
});

test("404 names the model", () => {
  assert.match(describeGeminiError(404, "{}", "gemini-x"), /"gemini-x"/);
});

test("only transient statuses are retried", () => {
  for (const s of [429, 500, 502, 503, 504]) assert.ok(isRetryable(s), String(s));
  for (const s of [400, 401, 403, 404]) assert.ok(!isRetryable(s), String(s));
});

test("backoff grows, is capped, honours Retry-After, and is capped and honours Retry-After", () => {
  const mid = () => 0.5; // no jitter
  assert.equal(backoffMs(1, null, mid), 2000);
  assert.equal(backoffMs(2, null, mid), 4000);
  assert.equal(backoffMs(9, null, mid), 10000);
  assert.equal(backoffMs(1, "7", mid), 7000);
  assert.equal(backoffMs(1, "120", mid), 15000);
  void MAX_ATTEMPTS;
});

test("rankFlashModels keeps Flash text models, stable and newest first", () => {
  const gc = ["generateContent"];
  const listed = [
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: gc },
    { name: "models/gemini-3-flash-preview", supportedGenerationMethods: gc },
    { name: "models/gemini-3-flash", supportedGenerationMethods: gc },
    { name: "models/gemini-flash-latest", supportedGenerationMethods: gc },
    { name: "models/gemini-3-flash-image", supportedGenerationMethods: gc },
    { name: "models/gemini-3-flash-tts", supportedGenerationMethods: gc },
    { name: "models/gemini-3-pro", supportedGenerationMethods: gc },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-3-flash", supportedGenerationMethods: gc }, // duplicate
  ];
  const ranked = rankFlashModels(listed, ["gemini-2.5-flash"]);
  assert.deepEqual(ranked, ["gemini-3-flash", "gemini-flash-latest", "gemini-3-flash-preview"]);
});

const DAILY_429 = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "35s" },
    ],
  },
});
const MINUTE_429 = JSON.stringify({
  error: { code: 429, details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] },
});

test("parseQuota reads which limit was hit and the suggested delay", () => {
  assert.deepEqual(parseQuota(DAILY_429), { scope: "day", freeTier: true, retryDelaySec: 35 });
  assert.equal(parseQuota(MINUTE_429).scope, "minute");
  assert.deepEqual(parseQuota("not json"), { scope: null, freeTier: false, retryDelaySec: null });
});

test("429 messages distinguish daily quota from per-minute limit", () => {
  const daily = describeGeminiError(429, DAILY_429, "gemini-3.8-flash");
  assert.match(daily, /free-tier daily request quota/);
  assert.match(daily, /enable billing/);
  assert.match(describeGeminiError(429, MINUTE_429, "m"), /per-minute request limit/);
  assert.equal(statusLabel(429, DAILY_429), "429 daily quota");
  assert.equal(statusLabel(429, MINUTE_429), "429 per-minute limit");
  assert.equal(statusLabel(503, ""), "503");
});

test("Flash-Lite ranks after full Flash models", () => {
  const gc = ["generateContent"];
  const ranked = rankFlashModels([
    { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: gc },
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: gc },
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: gc },
  ]);
  assert.deepEqual(ranked, ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"]);
});

test("five essential AI calls plus the founder's read (two attempts) fit inside the 300s limit", () => {
  assert.ok(5 * CALL_BUDGET_MS + 2 * FOUNDER_BUDGET_MS < 300_000);
});
