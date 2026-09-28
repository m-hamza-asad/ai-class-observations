import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@obs/shared/database";
import { SUPABASE_URL } from "./env";

/**
 * Service-role client, used only for auth admin calls (inviting users) and creating profiles.
 * Server-only; the key must never be exposed via a NEXT_PUBLIC_ variable.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient<Database>(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
