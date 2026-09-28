"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { ok?: string; error?: string } | null;

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  // shouldCreateUser: false: only invited accounts can sign in
  const { error } = await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: false } });
  if (error && error.status === 429) return { error: "Too many attempts. Wait a minute and try again." };
  if (error) console.warn(JSON.stringify({ stage: "login", error: error.message, code: error.code }));
  // Same message whether or not the account exists, so the form can't be used to probe emails.
  return { ok: "If this email has an account, a sign-in link is on its way. Check your inbox (and spam folder)." };
}
