// Row-level-security check against a LOCAL Supabase (npx supabase start). Creates throwaway users,
// signs in as each, and asserts what they can and cannot see/do. Run: npm run check-rls
// Never point this at a hosted project: it creates and deletes users and data.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error("Refusing to run against a non-local Supabase");
if (!SERVICE) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
const tag = `rls${Date.now()}`;
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

async function makeUser(label, role, campusId) {
  const email = `${tag}-${label}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  await svc.from("profiles").insert({ id: data.user.id, email, full_name: label, role, campus_id: campusId }).throwOnError();
  // sign in as them via a magic-link token (no email needed)
  const { data: link } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: vErr } = await client.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (vErr) throw vErr;
  return { id: data.user.id, client };
}

const { data: campusA } = await svc.from("campuses").insert({ name: `${tag} A` }).select().single();
const { data: campusB } = await svc.from("campuses").insert({ name: `${tag} B` }).select().single();
const adminA = await makeUser("adminA", "admin", campusA.id);
const adminB = await makeUser("adminB", "admin", campusB.id);
const t1 = await makeUser("teacher1", "teacher", campusA.id);
const t2 = await makeUser("teacher2", "teacher", campusA.id);

const { data: c1 } = await svc.from("classes").insert({ campus_id: campusA.id, name: `${tag} c1`, teacher_id: t1.id }).select().single();
const { data: c2 } = await svc.from("classes").insert({ campus_id: campusA.id, name: `${tag} c2`, teacher_id: t2.id }).select().single();
const { data: r2 } = await svc.from("recordings").insert({ campus_id: campusA.id, class_id: c2.id, teacher_id: t2.id, source: "upload" }).select().single();
const { data: r1 } = await svc.from("recordings").insert({ campus_id: campusA.id, class_id: c1.id, teacher_id: t1.id, source: "upload" }).select().single();
await svc.from("reports").insert({ recording_id: r1.id, status: "draft" }).throwOnError();
await svc.from("transcripts").insert({ recording_id: r1.id, full_text: "secret draft transcript" }).throwOnError();

try {
  // --- teacher 1 ---
  let res = await t1.client.from("classes").select("id");
  check("teacher sees only own classes", res.data?.length === 1 && res.data[0].id === c1.id, JSON.stringify(res.data));
  res = await t1.client.from("recordings").select("id");
  check("teacher sees only own recordings", res.data?.length === 1 && res.data[0].id === r1.id, JSON.stringify(res.data));
  res = await t1.client.from("profiles").select("id");
  check("teacher sees only own profile", res.data?.length === 1 && res.data[0].id === t1.id, JSON.stringify(res.data));
  res = await t1.client.from("reports").select("id");
  check("teacher cannot see draft report", res.data?.length === 0, JSON.stringify(res.data));
  res = await t1.client.from("transcripts").select("id");
  check("teacher cannot see transcript before report is final", res.data?.length === 0, JSON.stringify(res.data));
  res = await t1.client.from("profiles").update({ role: "admin" }).eq("id", t1.id).select();
  check("teacher cannot promote themselves", !res.data?.length, JSON.stringify(res));
  res = await t1.client.from("classes").insert({ campus_id: campusA.id, name: "sneaky" }).select();
  check("teacher cannot create classes", Boolean(res.error), JSON.stringify(res.data));
  res = await t1.client.from("recordings").insert({ campus_id: campusA.id, class_id: c2.id, teacher_id: t1.id, source: "upload" }).select();
  check("teacher cannot record for someone else's class", Boolean(res.error), JSON.stringify(res.data));
  res = await t1.client.from("recordings").insert({ campus_id: campusA.id, class_id: c1.id, teacher_id: t2.id, source: "upload" }).select();
  check("teacher cannot record as another teacher", Boolean(res.error), JSON.stringify(res.data));
  res = await t1.client.from("recordings").insert({ campus_id: campusA.id, class_id: c1.id, teacher_id: t1.id, source: "upload" }).select();
  check("teacher can create a recording for own class", !res.error && res.data?.length === 1, res.error?.message);
  res = await t1.client.from("recordings").update({ status: "ready" }).eq("id", r1.id).select();
  check("teacher cannot change recording status", !res.data?.length, JSON.stringify(res.data));

  // report becomes final -> teacher can read it (and its transcript)
  await svc.from("reports").update({ status: "final" }).eq("recording_id", r1.id);
  res = await t1.client.from("reports").select("id");
  check("teacher sees own report once final", res.data?.length === 1, JSON.stringify(res.data));
  res = await t1.client.from("transcripts").select("id");
  check("teacher sees transcript once report is final", res.data?.length === 1, JSON.stringify(res.data));

  // --- admins ---
  res = await adminA.client.from("classes").select("id").in("id", [c1.id, c2.id]);
  check("admin sees all classes in own campus", res.data?.length === 2, JSON.stringify(res.data));
  res = await adminB.client.from("classes").select("id").in("id", [c1.id, c2.id]);
  check("admin of another campus sees none of them", res.data?.length === 0, JSON.stringify(res.data));
  res = await adminB.client.from("recordings").select("id").in("id", [r1.id, r2.id]);
  check("admin of another campus sees no recordings", res.data?.length === 0, JSON.stringify(res.data));
  res = await adminB.client.from("classes").insert({ campus_id: campusA.id, name: "cross-campus" }).select();
  check("admin cannot create classes in another campus", Boolean(res.error), JSON.stringify(res.data));
  res = await adminA.client.from("profiles").update({ campus_id: campusB.id }).eq("id", t1.id).select();
  check("admin cannot move a teacher to another campus", Boolean(res.error) || !res.data?.length, JSON.stringify(res.data));

  // --- anonymous ---
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  res = await anon.from("classes").select("id");
  check("anonymous sees nothing", !res.data?.length, JSON.stringify(res.data));
  const { error: signupErr } = await anon.auth.signUp({ email: `${tag}-intruder@example.test`, password: "Password123!" });
  check("public sign-up is disabled", Boolean(signupErr), "sign-up succeeded");
} finally {
  // cleanup (service role)
  const recIds = (await svc.from("recordings").select("id").eq("campus_id", campusA.id)).data.map((r) => r.id);
  await svc.from("transcripts").delete().in("recording_id", recIds);
  await svc.from("reports").delete().in("recording_id", recIds);
  await svc.from("recordings").delete().in("id", recIds);
  await svc.from("classes").delete().in("campus_id", [campusA.id, campusB.id]);
  for (const u of [adminA, adminB, t1, t2]) await svc.auth.admin.deleteUser(u.id);
  await svc.from("campuses").delete().in("id", [campusA.id, campusB.id]);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll RLS checks passed");
process.exit(failures ? 1 : 0);
