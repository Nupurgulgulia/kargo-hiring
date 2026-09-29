import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage, redactSecrets } from "../src/lib/secrets.ts";

// Fake values shaped like the real ones; none of these are live credentials.
const FAKE_KEY_WITH_SPACE = "AQ.FakeKeyForTests0123456789-abcdefGHIJ klmnopQRSTUV";

test("redacts a key with a stray space, as echoed by fetch", () => {
  process.env.GEMINI_API_KEY = FAKE_KEY_WITH_SPACE;
  const msg = `Headers.append: "${FAKE_KEY_WITH_SPACE}" is an invalid header value.`;
  const out = redactSecrets(msg);
  assert.ok(!out.includes("FakeKeyForTests"), out);
  assert.ok(!out.includes("klmnopQRSTUV"), out);
  assert.match(out, /invalid header value/);
  delete process.env.GEMINI_API_KEY;
});

test("pattern backstop catches credential shapes not in env", () => {
  const msg = [
    "google AIzaSyFAKE0000000000000000000000000000",
    "resend re_FAKE000000000000000000",
    "neon npg_FAKE0000pw",
    "db postgresql://user:npg_FAKE0000pw@ep-fake.aws.neon.tech/neondb?sslmode=require",
  ].join(" | ");
  const out = redactSecrets(msg);
  for (const leaked of ["AIzaSyFAKE", "re_FAKE", "npg_FAKE", "ep-fake.aws"]) assert.ok(!out.includes(leaked), out);
});

test("leaves ordinary messages alone and keeps JSON valid", () => {
  assert.equal(redactSecrets("Gemini 429: rate limited"), "Gemini 429: rate limited");
  process.env.RESEND_API_KEY = "re_FAKE_resend_key_1234567890";
  const json = JSON.stringify({ error: "bad key re_FAKE_resend_key_1234567890 rejected" });
  const parsed = JSON.parse(redactSecrets(json));
  assert.equal(parsed.error, "bad key [REDACTED] rejected");
  delete process.env.RESEND_API_KEY;
});

test("errorMessage handles non-Error throws", () => {
  assert.equal(errorMessage("plain string"), "plain string");
  assert.equal(errorMessage(new Error("boom")), "boom");
});
