// One-time setup: create the campus (if needed) and invite the first admin.
// Usage: npm run bootstrap-admin -- <email> "<Full Name>" ["<Campus name>"]
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (apps/worker/.env locally).
import { createClient } from "@supabase/supabase-js";

const [email, fullName, campusName = "Main Campus"] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: npm run bootstrap-admin -- <email> "<Full Name>" ["<Campus name>"]');
  process.exit(1);
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let { data: campus } = await sb.from("campuses").select("id, name").eq("name", campusName).maybeSingle();
if (!campus) {
  ({ data: campus } = await sb.from("campuses").insert({ name: campusName }).select("id, name").single());
  console.log(`Created campus "${campus.name}"`);
}

const lower = email.trim().toLowerCase();
let userId;
const { data: invited, error } = await sb.auth.admin.inviteUserByEmail(lower, { data: { full_name: fullName } });
if (error) {
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  userId = list.users.find((u) => u.email?.toLowerCase() === lower)?.id;
  if (!userId) throw error;
  console.log(`User already exists in auth (${error.message}); attaching admin profile.`);
} else {
  userId = invited.user.id;
  console.log(`Invite email sent to ${lower}`);
}

const { error: pErr } = await sb
  .from("profiles")
  .upsert({ id: userId, email: lower, full_name: fullName, role: "admin", campus_id: campus.id, deactivated_at: null });
if (pErr) throw pErr;
console.log(`${fullName} <${lower}> is an admin of "${campus.name}".`);
