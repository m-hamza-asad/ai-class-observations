import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "My classes · Observe" };

export default async function TeacherHome() {
  const { profile } = await requireRole("teacher");
  const supabase = await createClient();
  // RLS limits this to the teacher's own classes
  const { data: classes } = await supabase.from("classes").select("id, name, subject, grade").is("archived_at", null).order("name");

  return (
    <>
      <PageHeader title={`Hello, ${profile.full_name.split(" ")[0] || "there"}`} description="Your classes. Lesson recording arrives in the next build step." />
      <Card title="My classes">
        {!classes?.length ? (
          <EmptyState>You haven&apos;t been assigned any classes yet. Ask your administrator.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {classes.map((c) => (
              <li key={c.id} className="py-3">
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-neutral-500">{[c.subject, c.grade && `Grade ${c.grade}`].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
