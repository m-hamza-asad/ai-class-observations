"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok?: string; error?: string } | null;

const inviteSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the person's name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  role: z.enum(["teacher", "admin"]),
});

function log(event: Record<string, unknown>) {
  console.info(JSON.stringify({ stage: "admin_people", ...event }));
}

export async function inviteUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await assertAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { full_name, email, role } = parsed.data;
  const sb = createAdminClient();

  const { data: existing } = await sb.from("profiles").select("id, deactivated_at").eq("email", email).maybeSingle();
  if (existing) {
    return { error: existing.deactivated_at ? "This person has a deactivated account. Reactivate them in the list below." : "This person already has an account." };
  }

  let userId: string | undefined;
  const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { data: { full_name } });
  if (error) {
    // An auth user without a profile can exist if an earlier invite half-failed; adopt it.
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (!userId) {
      log({ action: "invite", email, error: error.message });
      return { error: `Couldn't send the invite: ${error.message}` };
    }
  } else {
    userId = data.user.id;
  }

  const { error: profileErr } = await sb.from("profiles").insert({ id: userId, email, full_name, role, campus_id: admin.campus_id, invited_by: admin.id });
  if (profileErr) {
    log({ action: "invite_profile", email, error: profileErr.message });
    return { error: `Invite sent, but saving the profile failed: ${profileErr.message}` };
  }
  log({ action: "invite", email, role, by: admin.id });
  revalidatePath("/admin/teachers");
  return { ok: `Invite sent to ${email}.` };
}

async function campusMember(userId: string) {
  const admin = await assertAdmin();
  const sb = createAdminClient();
  const { data: profile } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile || profile.campus_id !== admin.campus_id) throw new Error("Not found");
  return { admin, sb, profile };
}

export async function resendInvite(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { sb, profile } = await campusMember(String(form.get("userId")));
  const { data: authUser } = await sb.auth.admin.getUserById(profile.id);
  if (authUser?.user?.last_sign_in_at) return { error: "They've already signed in. They can use the sign-in page." };
  const { error } = await sb.auth.admin.inviteUserByEmail(profile.email, { data: { full_name: profile.full_name } });
  if (error) return { error: error.message };
  log({ action: "resend_invite", userId: profile.id });
  return { ok: "Invite re-sent." };
}

export async function setActive(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { admin, sb, profile } = await campusMember(String(form.get("userId")));
  const activate = form.get("activate") === "1";
  if (profile.id === admin.id) return { error: "You can't deactivate your own account." };
  await sb.from("profiles").update({ deactivated_at: activate ? null : new Date().toISOString() }).eq("id", profile.id);
  // banning also stops them refreshing an existing session
  await sb.auth.admin.updateUserById(profile.id, { ban_duration: activate ? "none" : "876000h" });
  log({ action: activate ? "reactivate" : "deactivate", userId: profile.id, by: admin.id });
  revalidatePath("/admin/teachers");
  return { ok: activate ? "Reactivated." : "Deactivated." };
}
