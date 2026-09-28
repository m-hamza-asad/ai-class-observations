export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL ?? "").replace(/\/$/, "");

/** The recording lab works without Supabase; everything else needs it. */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
