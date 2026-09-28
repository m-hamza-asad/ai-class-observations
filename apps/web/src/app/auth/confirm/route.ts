import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for invite and magic-link emails. The link carries a token_hash that is verified
 * server-side, so it works even when opened on a different device than the one that requested it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/", origin));
    console.warn(JSON.stringify({ stage: "auth_confirm", type, error: error.message }));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
