import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Tables } from "@obs/shared/database";
import { createClient } from "./supabase/server";

export type Profile = Tables<"profiles">;

/** Signed-in user + profile for this request (deduped across layouts/pages via React cache). */
export const getViewer = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return { userId, email: (data.claims.email as string | undefined) ?? "", profile: profile && !profile.deactivated_at ? profile : null };
});

export async function requireRole(role: Profile["role"]) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.profile) redirect("/no-access");
  if (viewer.profile.role !== role) redirect("/");
  return { ...viewer, profile: viewer.profile };
}

/** For server actions: returns the admin profile or throws (actions can't rely on page-level guards). */
export async function assertAdmin() {
  const viewer = await getViewer();
  if (!viewer?.profile || viewer.profile.role !== "admin") throw new Error("Not authorized");
  return viewer.profile;
}
