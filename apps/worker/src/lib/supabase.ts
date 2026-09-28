import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@obs/shared/database";
import { config } from "../config.js";

export type ServiceClient = SupabaseClient<Database>;

let client: ServiceClient | null = null;

/** Service-role client: bypasses RLS. Only ever used server-side in the worker. */
export function db(): ServiceClient {
  if (!client) {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured");
    client = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
