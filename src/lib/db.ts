import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { isReadOnlySql, isTransientConnectionError, RETRY_DELAYS_MS } from "./db-retry";
import { redactSecrets } from "./secrets";
import type { EventRow, Rubric, Role } from "./types";

// Direct Postgres (Neon) access. The pooled DATABASE_URL goes through PgBouncer; on Vercel,
// attachDatabasePool lets Fluid compute close idle clients before a function is suspended.

// Return numerics as numbers and timestamps as ISO strings, matching what the app expects.
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) =>
  new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString(),
);

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set");
  pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5000, keepAlive: true });
  // An idle client dropped by the server emits an error on the pool; without a handler it would crash the process.
  pool.on("error", () => {});
  attachDatabasePool(pool);
  return pool;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Neon wakes a suspended database on the first connection, which can drop once. So: a failed
// connect is always retried (nothing was sent), and a failed read is retried too. A write that
// failed after being sent is not retried, because it may already have run.
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const readOnly = isReadOnlySql(text);
  for (let attempt = 0; ; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    let client: PoolClient;
    try {
      client = await getPool().connect();
    } catch (err) {
      if (delay === undefined || !isTransientConnectionError(err)) throw err;
      await sleep(delay);
      continue;
    }
    try {
      const res = await client.query<T>(text, params);
      client.release();
      return res.rows;
    } catch (err) {
      const connectionBroke = isTransientConnectionError(err);
      client.release(connectionBroke); // true destroys a broken client instead of returning it to the pool
      if (!(connectionBroke && readOnly) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

// jsonb parameters must be serialized explicitly: pg would turn JS arrays into Postgres arrays.
export const json = (value: unknown) => JSON.stringify(value);

export async function getRubrics(): Promise<Record<Role, Rubric>> {
  const rows = await query<Rubric>(
    "select role, title, threshold, lower_tier_below, criteria, scale, notes from kargo_rubrics",
  );
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
  if (!byRole.PM || !byRole.SPM) throw new Error("Both PM and SPM rubrics must exist");
  return byRole as Record<Role, Rubric>;
}

export async function logEvent(
  candidateId: string | null,
  actor: EventRow["actor"],
  action: string,
  detail?: Record<string, unknown>,
) {
  await query("insert into kargo_events (candidate_id, actor, action, detail) values ($1, $2, $3, $4::jsonb)", [
    candidateId,
    actor,
    action,
    detail ? redactSecrets(json(detail)) : null,
  ]);
}
