import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@obs/shared/database";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** Per-request client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component: cookies are read-only there; the proxy refreshes the session instead
        }
      },
    },
  });
}
