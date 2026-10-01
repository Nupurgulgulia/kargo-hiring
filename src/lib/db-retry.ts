// Neon's free tier suspends an idle database and wakes it on the next connection; that first
// connection (or a pooled connection that went stale while idle) can drop with "Connection
// terminated unexpectedly". These helpers decide what is safe to retry. Pure, so they are testable.

export const RETRY_DELAYS_MS = [250, 750, 1500];

const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "57P01", "57P03", "08006", "08001", "08004"]);

export function isTransientConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /connection terminated|terminating connection|server closed the connection|connection timeout|timeout exceeded when trying to connect|database system is (?:starting up|waking)|ECONNRESET|EPIPE/i.test(msg);
}

// Only plain reads are retried once a query has been sent. A write whose connection dropped may
// already have run, and running it twice would be worse than failing.
export function isReadOnlySql(text: string): boolean {
  return /^\s*(?:select|show)\b/i.test(text) && !/\bfor\s+(?:update|share|no\s+key\s+update|key\s+share)\b/i.test(text);
}
