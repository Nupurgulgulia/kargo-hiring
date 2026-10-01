import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadOnlySql, isTransientConnectionError, RETRY_DELAYS_MS } from "../src/lib/db-retry.ts";

test("recognises the errors a waking or idle-dropped Neon connection produces", () => {
  for (const msg of [
    "Connection terminated unexpectedly",
    "terminating connection due to administrator command",
    "Connection terminated due to connection timeout",
    "timeout exceeded when trying to connect",
    "the database system is starting up",
    "read ECONNRESET",
  ]) {
    assert.ok(isTransientConnectionError(new Error(msg)), msg);
  }
  assert.ok(isTransientConnectionError(Object.assign(new Error("x"), { code: "57P01" })));
});

test("does not treat real SQL errors as transient", () => {
  for (const msg of ['relation "kargo_x" does not exist', "duplicate key value violates unique constraint", "invalid input syntax for type json"]) {
    assert.ok(!isTransientConnectionError(new Error(msg)), msg);
  }
  assert.ok(!isTransientConnectionError(Object.assign(new Error("x"), { code: "23505" })));
});

test("only plain reads are retried after being sent", () => {
  assert.ok(isReadOnlySql("select * from kargo_candidates where id = $1"));
  assert.ok(isReadOnlySql("  SELECT 1"));
  for (const sql of [
    "update kargo_emails set status = 'sending' returning *",
    "insert into kargo_events (action) values ($1)",
    "delete from kargo_candidates where id = $1",
    "select * from kargo_emails where candidate_id = $1 for update",
    "with x as (delete from t returning *) select * from x",
  ]) {
    assert.ok(!isReadOnlySql(sql), sql);
  }
});

test("retry backoff stays short enough for a page load", () => {
  assert.ok(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) <= 3000);
});
