import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { currentTerm, fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { NewTermForm, TermEndForm } from "./TermForms";

export const metadata = { title: "Terms · Observe" };

export default async function TermsPage() {
  const supabase = await createClient();
  const { data: terms } = await supabase.from("academic_terms").select("*").order("starts_on", { ascending: false });
  const current = currentTerm(terms ?? []);

  return (
    <>
      <PageHeader
        title="Terms"
        description="Lesson videos are kept until the end of the term they were recorded in, then deleted automatically. Transcripts and reports are kept permanently."
      />
      <Card title="Add a term" className="mb-6">
        <NewTermForm />
      </Card>
      <Card title="Terms">
        {!terms?.length ? (
          <EmptyState>No terms yet. Add the current term so recordings get an expiry date.</EmptyState>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {terms.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {t.name} {t.id === current?.id && <Badge tone="green">current</Badge>}
                  </div>
                  <div className="text-sm text-neutral-500">
                    {fmtDate(t.starts_on)} – {fmtDate(t.ends_on)}
                  </div>
                </div>
                <TermEndForm id={t.id} endsOn={t.ends_on} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
