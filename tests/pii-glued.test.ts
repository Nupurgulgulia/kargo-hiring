import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoPII, detectContact, redact } from "../src/lib/pii.ts";

const NL = String.fromCharCode(10);

test("phone numbers glued together by overlapping text layers are still removed", () => {
  const text = [
    "Product Manager",
    "mail@example.com+91 99014 28453 +91 99014 2845399014 28453 99014 28453 handle",
    "Jul 2023 - Apr 2024",
  ].join(NL);
  const contact = detectContact(text);
  assert.ok(contact.phone, "phone should be detected");
  const out = redact(text, contact);
  assert.doesNotThrow(() => assertNoPII(out, contact));
  assert.ok(!/99014/.test(out) && !/28453/.test(out), out);
  assert.ok(out.includes("Jul 2023 - Apr 2024"), "dates survive");
});
