import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, Rubric, Role } from "./types";

let client: SupabaseClient | null = null;

// Server-only client using the secret/service-role key. All kargo_* tables have RLS enabled
// with no policies, so the browser can never read candidate data directly.
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const CV_BUCKET = "kargo-cvs";

export async function getRubrics(): Promise<Record<Role, Rubric>> {
  const { data, error } = await db().from("kargo_rubrics").select("*");
  if (error) throw new Error(`Failed to load rubrics: ${error.message}`);
  const byRole = Object.fromEntries((data as Rubric[]).map((r) => [r.role, r]));
  if (!byRole.PM || !byRole.SPM) throw new Error("Both PM and SPM rubrics must exist");
  return byRole as Record<Role, Rubric>;
}

export async function logEvent(
  candidateId: string | null,
  actor: EventRow["actor"],
  action: string,
  detail?: Record<string, unknown>,
) {
  await db()
    .from("kargo_events")
    .insert({ candidate_id: candidateId, actor, action, detail: detail ?? null });
}
