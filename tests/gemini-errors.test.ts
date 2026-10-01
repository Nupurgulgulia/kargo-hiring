import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs, describeGeminiError, isRetryable, MAX_ATTEMPTS } from "../src/lib/gemini-errors.ts";

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

test("backoff grows, is capped, honours Retry-After, and totals about a minute", () => {
  const mid = () => 0.5; // no jitter
  assert.equal(backoffMs(1, null, mid), 2000);
  assert.equal(backoffMs(2, null, mid), 4000);
  assert.equal(backoffMs(9, null, mid), 20000);
  assert.equal(backoffMs(1, "7", mid), 7000);
  assert.equal(backoffMs(1, "120", mid), 30000);
  let total = 0;
  for (let a = 1; a < MAX_ATTEMPTS; a++) total += backoffMs(a, null, mid);
  assert.ok(total >= 40000 && total <= 70000, String(total));
});
