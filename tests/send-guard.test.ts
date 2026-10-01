import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Structural guarantees for the original design: no email of any kind is sent unless Arjun clicks
// Send and confirms. These read the source, so they fail if anyone adds another path that sends.

const SRC = join(import.meta.dirname, "..", "src");
const ROOT = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const files = walk(SRC).map((p) => ({ path: relative(ROOT, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));

test("only the Send route can call sendCandidateEmail", () => {
  const users = files.filter((f) => f.text.includes("sendCandidateEmail")).map((f) => f.path).sort();
  assert.deepEqual(users, ["src/app/api/candidates/[id]/send/route.ts", "src/lib/email.ts"]);
});

test("Resend is called from exactly one place", () => {
  const callers = files.filter((f) => /\.emails\.send\(/.test(f.text)).map((f) => f.path);
  assert.deepEqual(callers, ["src/lib/email.ts"]);
});

test("the scoring pipeline, AI steps and queries cannot reach the sender", () => {
  for (const name of ["pipeline", "ai", "founder", "scoring", "queries", "gemini", "db"]) {
    const f = files.find((x) => x.path === `src/lib/${name}.ts`);
    assert.ok(f, `${name}.ts exists`);
    assert.ok(!/from\s+["']\.\/email["']/.test(f!.text), `${name}.ts must not import ./email`);
  }
});

test("the Send route refuses anything but an explicit confirmation", () => {
  const route = files.find((f) => f.path === "src/app/api/candidates/[id]/send/route.ts")!;
  assert.match(route.text, /confirm\s*!==\s*true/);
  assert.match(route.text, /status:\s*400/);
});

test("no automatic-sending switch or scheduled job exists", () => {
  for (const f of files) assert.ok(!/AUTO_SEND|autoSend|auto-send|auto:\s*true/i.test(f.text), `${f.path} mentions automatic sending`);
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.equal(vercel.crons, undefined, "vercel.json must not schedule jobs");
});
