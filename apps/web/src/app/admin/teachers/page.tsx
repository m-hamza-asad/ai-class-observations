import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import InviteForm from "./InviteForm";
import RowActions from "./RowActions";

export const metadata = { title: "People · Observe" };

export default async function PeoplePage() {
  const { profile: me } = await requireRole("admin");
  const supabase = await createClient();
  const [{ data: people }, { data: classes }] = await Promise.all([
    supabase.from("profiles").select("*").order("role").order("full_name"),
    supabase.from("classes").select("id, name, teacher_id").is("archived_at", null),
  ]);
  // sign-in status lives in auth.users, which only the service role can read
  const { data: authList } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  const lastSignIn = new Map(authList?.users.map((u) => [u.id, u.last_sign_in_at]) ?? []);

  return (
    <>
      <PageHeader title="People" description="Invite teachers and admins. They sign in with a one-time link sent to their email." />
      <Card title="Invite someone" className="mb-6">
        <InviteForm />
      </Card>
      <Card title={`Everyone (${people?.length ?? 0})`}>
        {!people?.length ? (
          <EmptyState>No one yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {people.map((p) => {
              const signedIn = lastSignIn.get(p.id);
              const theirClasses = classes?.filter((c) => c.teacher_id === p.id) ?? [];
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {p.full_name || p.email}
                      <Badge tone={p.role === "admin" ? "blue" : "neutral"}>{p.role}</Badge>
                      {p.deactivated_at ? <Badge tone="red">deactivated</Badge> : signedIn ? <Badge tone="green">active</Badge> : <Badge tone="amber">invited</Badge>}
                    </div>
                    <div className="text-sm text-neutral-500">
                      {p.email}
                      {signedIn && ` · last signed in ${fmtDate(signedIn)}`}
                      {p.role === "teacher" && ` · ${theirClasses.length ? theirClasses.map((c) => c.name).join(", ") : "no classes"}`}
                    </div>
                  </div>
                  <RowActions userId={p.id} invited={!signedIn} active={!p.deactivated_at} isSelf={p.id === me.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
