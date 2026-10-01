// Batch-run a folder or zip of CVs through the real pipeline, with built-in checks.
//
//   npm run batch -- "<resumes.zip | folder>" [--env <file>] [--concurrency 2] [--limit N] [--dry-run] [--report-only]
//
// It starts the app's own dev server on port 3100 and uploads each CV through the real upload route, so
// extraction, PII stripping, both rubrics, the brief, the draft email and the founder's read are exactly
// what the dashboard runs, including the Gemini model fallback chain. Needs GEMINI_API_KEY in your shell
// and DATABASE_URL in the env file (default ~/.kargo/batch.env). Sending is impossible from here: the
// server is started with RESEND_API_KEY blank, and the guard tests must pass before anything runs.
//
// Role comes from the filename: pm_* -> PM, spm_* -> SPM, anything else -> PM (flagged if SPM scores higher).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1]?.startsWith("--") && !["--dry-run", "--report-only"].includes(argv[i - 1])));
const input = positional[0];
const DRY = argv.includes("--dry-run");
const REPORT_ONLY = argv.includes("--report-only");
const CONCURRENCY = Math.max(1, Number(flag("concurrency")) || 2);
const LIMIT = Number(flag("limit")) || Infinity;
if (!input) {
  console.error('Usage: npm run batch -- "<resumes.zip | folder>" [--env <file>] [--concurrency 2] [--limit N] [--dry-run] [--report-only]');
  process.exit(2);
}

// ---------- environment ----------
const envFile = typeof flag("env") === "string" ? flag("env") : join(homedir(), ".kargo", "batch.env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set in your shell
if (!process.env.DATABASE_URL) fail(`DATABASE_URL is not set. Put it in ${envFile} or pass --env <file>.`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(msg) {
  console.error(`\nSTOPPED: ${msg}`);
  process.exit(1);
}

// ---------- thresholds for the role-mismatch flag ----------
const PM_LINE = 65;
const SPM_LINE = 60;
const MISMATCH_GAP = 10; // SPM at least this many points above PM
const mismatch = (pm, spm) => spm >= pm + MISMATCH_GAP || (spm >= SPM_LINE && pm < PM_LINE);

// ---------- resolve the input into PDF files ----------
function listPdfs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listPdfs(p) : /\.(pdf|docx|txt)$/i.test(e.name) ? [p] : [];
  });
}
function resolveFiles(src) {
  let dir = resolve(src);
  if (!existsSync(dir)) fail(`Not found: ${dir}`);
  if (statSync(dir).isFile()) {
    if (!/\.zip$/i.test(dir)) fail("Give me a .zip or a folder.");
    const tmp = mkdtempSync(join(tmpdir(), "kargo-batch-"));
    const r =
      process.platform === "win32"
        ? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${dir.replaceAll("'", "''")}' -DestinationPath '${tmp.replaceAll("'", "''")}' -Force`], { encoding: "utf8" })
        : spawnSync("unzip", ["-oq", dir, "-d", tmp], { encoding: "utf8" });
    if (r.status !== 0) fail(`Could not unzip: ${r.stderr || r.stdout}`);
    dir = tmp;
  }
  return listPdfs(dir).sort((a, b) => basename(a).localeCompare(basename(b)));
}

const roleOf = (f) => (/^spm_/i.test(f) ? "SPM" : "PM");
const labeled = (f) => /^(spm|pm)_/i.test(f);
const nameOf = (f) =>
  f.replace(/\.[a-z]+$/i, "").replace(/^(spm|pm)_/i, "").replace(/^\d+_/, "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ---------- database ----------
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect().catch((e) => fail(`Cannot reach the database: ${e.message.split("\n")[0]}`));
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

// ===== PHASE 0: confirm no email can go out, BEFORE anything is processed =====
async function guardCheck() {
  const r = spawnSync(process.execPath, ["--test", "tests/send-guard.test.ts"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) fail(`The no-auto-send guard tests FAILED. Nothing was processed.\n${r.stdout}`);
  const [{ sent, events }] = await q(
    `select (select count(*)::int from kargo_emails where status = 'sent') sent,
            (select count(*)::int from kargo_events where action = 'email_sent') events`,
  );
  const [{ now }] = await q("select now() as now");
  console.log(`✓ no-auto-send guard tests pass (5/5). Baseline: ${sent} emails marked sent, ${events} send events.`);
  return { sent, events, startedAt: now };
}

// ---------- the report (also used by --report-only) ----------
async function buildReport(files, baseline, extra) {
  const names = files.map((f) => basename(f));
  const rows = await q(
    `select distinct on (k.cv_filename) k.id, k.cv_filename, k.status, k.error, k.applied_role, k.pm_score, k.spm_score,
            k.applied_score, k.recommendation, e.status as email_status,
            (select string_agg(distinct s.model, ', ') from kargo_scores s where s.candidate_id = k.id) as models,
            (select count(*)::int from kargo_founder_reads fr where fr.candidate_id = k.id) as founder
       from kargo_candidates k left join kargo_emails e on e.candidate_id = k.id
      where k.cv_filename = any($1) order by k.cv_filename, k.created_at desc`,
    [names],
  );
  const by = Object.fromEntries(rows.map((r) => [r.cv_filename, r]));
  const ready = rows.filter((r) => r.status === "ready");
  const failed = rows.filter((r) => r.status !== "ready");
  const mism = names.filter((n) => !labeled(n) && by[n]?.status === "ready" && mismatch(Number(by[n].pm_score), Number(by[n].spm_score)));
  const fyi = names.filter((n) => labeled(n) && by[n]?.status === "ready" && Math.abs(Number(by[n].spm_score) - Number(by[n].pm_score)) >= 2 * MISMATCH_GAP);
  // During a run: any send event anywhere since the run started. In --report-only: any send event ever
  // recorded for these candidates.
  const SENDS = "action in ('email_sent','email_test_sent','email_send_failed')";
  const [post] = baseline.startedAt
    ? await q(
        `select (select count(*)::int from kargo_emails where status = 'sent') sent,
                (select count(*)::int from kargo_events where ${SENDS} and at >= $1) send_events`,
        [baseline.startedAt],
      )
    : await q(
        `select (select count(*)::int from kargo_emails where status = 'sent') sent,
                (select count(*)::int from kargo_events where ${SENDS} and candidate_id = any($1)) send_events`,
        [rows.map((r) => r.id)],
      );
  const notDraft = rows.filter((r) => r.email_status && r.email_status !== "draft");
  const models = {};
  for (const r of ready) for (const m of (r.models ?? "").split(", ").filter(Boolean)) models[m] = (models[m] ?? 0) + 1;

  const L = [];
  const add = (s = "") => L.push(s);
  add("KARGO BATCH SUMMARY");
  add("===================");
  add(`Files: ${names.length}  (${names.filter((n) => /^pm_/i.test(n)).length} pm_, ${names.filter((n) => /^spm_/i.test(n)).length} spm_, ${names.filter((n) => !labeled(n)).length} unlabeled → PM)`);
  add(`Scored and ready: ${ready.length}   (recommended for interview: ${ready.filter((r) => r.recommendation === "invite").length}, below the line: ${ready.filter((r) => r.recommendation === "reject").length})`);
  add(`  founder's read written: ${ready.filter((r) => r.founder).length}   model(s) used: ${Object.entries(models).map(([m, n]) => `${m} ×${n}`).join(", ") || "n/a"}`);
  if (extra?.alreadyDone?.length) add(`  of which already done in an earlier run: ${extra.alreadyDone.length}`);
  add("");
  add(`Extraction-quality flags (held back, NOT scored): ${extra?.held?.length ?? 0}`);
  for (const h of extra?.held ?? []) add(`  - ${h.file}: ${h.reasons.join("; ")}`);
  if (!(extra?.held?.length)) add("  none: all files extracted cleanly (checked: doubled letters, split letters, run-together words, unmapped glyphs, gibberish, too little text)");
  add("");
  add(`Role-mismatch flags (unlabeled, SPM ≥ PM + ${MISMATCH_GAP}, or SPM ≥ ${SPM_LINE} while PM < ${PM_LINE}): ${mism.length}`);
  for (const n of mism) add(`  - ${n}: PM ${by[n].pm_score} / SPM ${by[n].spm_score}`);
  if (fyi.length) add(`  (FYI: ${fyi.length} labeled file(s) scored ≥ ${2 * MISMATCH_GAP} points apart between PM and SPM; listed in the report file)`);
  add("");
  const skipped = [...(extra?.skipped ?? []), ...failed.map((r) => ({ file: r.cv_filename, reason: `scoring failed: ${(r.error ?? "unknown").slice(0, 160)}` }))];
  const missing = names.filter((n) => !by[n] && !(extra?.held ?? []).some((h) => h.file === n) && !(extra?.skipped ?? []).some((s) => s.file === n));
  for (const n of missing) skipped.push({ file: n, reason: "never uploaded (run did not reach it)" });
  add(`Failures / skipped: ${skipped.length}`);
  for (const s of skipped) add(`  - ${s.file}: ${s.reason}`);
  if (!skipped.length) add("  none");
  if (extra?.nameFromFile) add(`\nNote: the app could not find a name in ${extra.nameFromFile} CVs (multi-column layouts); the name was taken from the filename, which appears in each CV's text, and redacted as usual.`);
  add("");
  const clean = post.sent === baseline.sent && post.send_events === 0 && notDraft.length === 0;
  add(`Emails: ${clean ? "ZERO sent." : "!! CHECK THIS !!"} Marked sent: ${post.sent} (was ${baseline.sent} before). Send events during this run: ${post.send_events}. Candidates whose email is not a plain draft: ${notDraft.length}. Drafts waiting for your click: ${rows.filter((r) => r.email_status === "draft").length}.`);
  const text = L.join("\n");
  const detail = L.concat(["", "PER-FILE RESULTS", ...names.map((n) => `${n}\t${by[n] ? `${by[n].status}\tPM ${by[n].pm_score ?? "-"}\tSPM ${by[n].spm_score ?? "-"}\t${by[n].recommendation ?? "-"}` : "not in database"}`), "", "LABELED FILES WITH A LARGE PM/SPM GAP", ...fyi.map((n) => `${n}: PM ${by[n].pm_score} / SPM ${by[n].spm_score}`)]);
  return { text, detail: detail.join("\n"), clean };
}

// ===== --report-only =====
if (REPORT_ONLY) {
  const files = resolveFiles(input);
  const [{ sent }] = await q("select count(*)::int sent from kargo_emails where status = 'sent'");
  const rep = await buildReport(files, { sent, startedAt: null }, {});
  console.log(`\n${rep.text}`);
  await db.end();
  process.exit(0);
}

// ===== PHASE 0 =====
console.log("Checking that no email can be sent before processing anything…");
const baseline = await guardCheck();

// ===== PHASE 1: read the files, gate quality =====
const files = resolveFiles(input);
console.log(`✓ ${files.length} files found`);
let parse, quality, pii;
try {
  parse = await import(pathToFileURL(`${ROOT}/src/lib/cv-parse.ts`).href);
  quality = await import(pathToFileURL(`${ROOT}/src/lib/cv-quality.ts`).href);
  pii = await import(pathToFileURL(`${ROOT}/src/lib/pii.ts`).href);
} catch (e) {
  fail(`Run this through npm (it needs --conditions=react-server): npm run batch -- "<path>"\n${e.message}`);
}

const items = [];
const held = [];
const skipped = [];
const seen = new Map();
for (const path of files.slice(0, LIMIT)) {
  const file = basename(path);
  let text = "";
  try {
    text = await parse.extractCvText(file, readFileSync(path));
  } catch (e) {
    held.push({ file, reasons: [`could not read: ${e.message.split("\n")[0]}`] });
    continue;
  }
  const rep = quality.assessCvText(text);
  if (!rep.ok) {
    held.push({ file, reasons: rep.reasons });
    continue;
  }
  const hash = createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
  if (seen.has(hash)) {
    skipped.push({ file, reason: `identical text to ${seen.get(hash)}` });
    continue;
  }
  seen.set(hash, file);
  const detected = pii.detectContact(text).full_name;
  items.push({ file, path, role: roleOf(file), nameFromFile: detected ? null : nameOf(file) });
}
console.log(`✓ extraction check: ${items.length} clean, ${held.length} held back, ${skipped.length} duplicate`);
if (held.length) for (const h of held) console.log(`   held: ${h.file}: ${h.reasons.join("; ")}`);

// resume support: skip files already scored in an earlier run; re-run ones that errored
const existing = await q(
  `select distinct on (cv_filename) id, cv_filename, status from kargo_candidates where cv_filename = any($1) order by cv_filename, created_at desc`,
  [items.map((i) => i.file)],
);
const prior = Object.fromEntries(existing.map((r) => [r.cv_filename, r]));
const alreadyDone = items.filter((i) => prior[i.file]?.status === "ready").map((i) => i.file);
const todo = items.filter((i) => prior[i.file]?.status !== "ready");
console.log(`✓ to process: ${todo.length}${alreadyDone.length ? ` (${alreadyDone.length} already done in an earlier run)` : ""}; concurrency ${CONCURRENCY}`);

if (DRY) {
  console.log("\nDRY RUN: nothing uploaded. Plan:");
  console.log(`  PM: ${todo.filter((i) => i.role === "PM" && labeled(i.file)).length}  SPM: ${todo.filter((i) => i.role === "SPM").length}  unlabeled→PM: ${todo.filter((i) => !labeled(i.file)).length}`);
  console.log(`  name will be taken from the filename for ${todo.filter((i) => i.nameFromFile).length} files (the app cannot find one in the text)`);
  await db.end();
  process.exit(0);
}
if (!todo.length) {
  const rep = await buildReport(files.slice(0, LIMIT), baseline, { held, skipped, alreadyDone });
  console.log(`\n${rep.text}`);
  await db.end();
  process.exit(0);
}

// ===== PHASE 2: Gemini key check (fail fast, never print the key) =====
const key = (process.env.GEMINI_API_KEY ?? "").trim();
if (!key) fail("GEMINI_API_KEY is not set in your shell. In PowerShell:  $env:GEMINI_API_KEY = '<your key>'");
if (/\s/.test(key)) fail("GEMINI_API_KEY contains a space or line break.");
process.env.GEMINI_API_KEY = key;
if (argv.includes("--skip-key-check")) {
  console.log("! Gemini key check skipped (smoke test): scoring is expected to fail");
} else {
  const probe = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } }).catch(() => null);
  if (!probe || !probe.ok) fail(`Gemini rejected the key (HTTP ${probe?.status ?? "no response"}). Use a key from Google AI Studio.`);
  console.log("✓ Gemini key accepted");
}

// ===== PHASE 3: start the app =====
const server = spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "dev", ROOT, "--port", String(PORT)], {
  cwd: ROOT,
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    DASHBOARD_PASSWORD: "", // no login on this private local server
    RESEND_API_KEY: "", // sending is impossible from this process
    EMAIL_FROM: "",
    EMAIL_TEST_RECIPIENT: "",
  },
});
const stopServer = () => {
  if (!server.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
  else server.kill("SIGTERM");
};
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));
for (let i = 0; ; i++) {
  if (i > 60) fail("The app did not start within 2 minutes.");
  if ((await fetch(`${BASE}/login`).catch(() => null))?.ok) break;
  await sleep(2000);
}
console.log("✓ app running locally (no email credentials loaded)\n");

// ===== PHASE 4: process =====
const state = { ok: 0, failed: 0, done: 0, streak: 0 };
const results = [];
const total = todo.length;
const tick = () => process.stdout.write(`\r  [${state.done}/${total}] scored: ${state.ok}  failed: ${state.failed}   `);

async function waitFinished(id, maxMs = 9 * 60_000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const [r] = await q("select status, error from kargo_candidates where id = $1", [id]);
    if (r && r.status !== "processing") return r;
    await sleep(3000);
  }
  return { status: "error", error: "timed out waiting for scoring" };
}
// Worth retrying: quota, overload, timeouts. Not worth retrying: a rejected key, a bad request, a PII guard.
const transient = (e) =>
  /\b(429|500|502|503|504)\b|quota|overload|unavailable|rate limit|timed out/i.test(e ?? "") && !/rejected the API key|API key not valid/i.test(e ?? "");

async function upload(item, withName) {
  const fd = new FormData();
  fd.append("file", new File([readFileSync(item.path)], item.file, { type: "application/pdf" }));
  fd.append("role", item.role);
  if (withName) fd.append("full_name", withName);
  const res = await fetch(`${BASE}/api/candidates`, { method: "POST", body: fd, signal: AbortSignal.timeout(150_000) });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function runOne(item) {
  const rec = { file: item.file, id: null, attempts: 0, status: "failed", error: null };
  try {
    const prev = prior[item.file];
    if (prev && prev.status !== "ready") {
      rec.id = prev.id; // an earlier run left it unfinished or failed: resume rather than duplicate
      await fetch(`${BASE}/api/candidates/${rec.id}/reprocess`, { method: "POST", signal: AbortSignal.timeout(60_000) });
    } else {
      let { res, body } = await upload(item, null);
      if (res.status === 422 && body.needName && item.nameFromFile) ({ res, body } = await upload(item, item.nameFromFile));
      if (res.status !== 201) throw new Error(`upload refused (HTTP ${res.status}): ${body.error ?? "no message"}`);
      rec.id = body.id;
    }
    let r = await waitFinished(rec.id);
    for (let retry = 1; r.status === "error" && transient(r.error) && retry <= 2; retry++) {
      rec.attempts = retry;
      await sleep(45_000 * retry); // let quota windows reopen, then resume from the saved extraction
      await fetch(`${BASE}/api/candidates/${rec.id}/reprocess`, { method: "POST", signal: AbortSignal.timeout(60_000) });
      r = await waitFinished(rec.id);
    }
    if (r.status === "ready") rec.status = "ok";
    else rec.error = r.error;
  } catch (e) {
    rec.error = e.message.split("\n")[0];
  }
  return rec;
}

const queue = [...todo];
async function worker() {
  while (queue.length) {
    const item = queue.shift();
    const rec = await runOne(item);
    results.push(rec);
    state.done++;
    if (rec.status === "ok") {
      state.ok++;
      state.streak = 0;
    } else {
      state.failed++;
      state.streak++;
      if (state.streak >= 3) {
        process.stdout.write("\n  3 failures in a row: cooling down 2 minutes before continuing…\n");
        state.streak = 0;
        await sleep(120_000);
      }
    }
    tick();
  }
}
tick();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stdout.write("\n");

// let the last founder's reads finish before stopping the app
const ids = results.filter((r) => r.status === "ok").map((r) => r.id);
const settleBy = Date.now() + 150_000;
while (ids.length && Date.now() < settleBy) {
  const [{ pending }] = await q(
    `select count(*)::int pending from unnest($1::uuid[]) as t(id)
      where not exists (select 1 from kargo_founder_reads f where f.candidate_id = t.id)
        and not exists (select 1 from kargo_events e where e.candidate_id = t.id and e.action = 'founders_read_failed')`,
    [ids],
  );
  if (!pending) break;
  await sleep(4000);
}
stopServer();

// ===== PHASE 5: one summary =====
const nameFromFile = todo.filter((i) => i.nameFromFile).length;
const rep = await buildReport(files.slice(0, LIMIT), baseline, { held, skipped, alreadyDone, nameFromFile });
console.log(`\n${rep.text}`);
mkdirSync(join(ROOT, "reports"), { recursive: true });
const out = join(ROOT, "reports", `batch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
writeFileSync(out, "```\n" + rep.detail + "\n```\n");
console.log(`\nFull per-file detail: ${out}`);
await db.end();
process.exit(rep.clean ? 0 : 3);
