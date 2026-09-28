import type { FrameworkDefinition } from "@obs/shared";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Observation framework · Observe" };

export default async function FrameworkPage() {
  const supabase = await createClient();
  const { data: template } = await supabase.from("report_templates").select("*").eq("is_active", true).maybeSingle();
  if (!template) return <EmptyState>No active observation framework is configured.</EmptyState>;
  const def = template.definition as unknown as FrameworkDefinition;
  const needsDefinition = def.categories.flatMap((c) => c.criteria.filter((k) => k.guidance_status === "needs_school_definition").map((k) => k.title));

  return (
    <>
      <PageHeader
        title={def.framework_name}
        description={`Version ${template.version} · active since ${fmtDate(template.created_at)} · used for every lesson in every class`}
      />

      <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <p className="font-medium">AI output is a draft for administrator review</p>
        <p className="mt-1">{def.review_notice}</p>
      </div>

      {needsDefinition.length > 0 && (
        <Card title="Descriptors to confirm with the school" className="mb-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            The AI is currently using working descriptors for these school-specific terms. They should be replaced with the exact definitions from the school&apos;s
            training documents: <span className="font-medium">{needsDefinition.join(", ")}</span>.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {def.categories.map((cat, i) => (
            <Card
              key={cat.key}
              title={
                <span>
                  {i + 1}. {cat.title}
                </span>
              }
            >
              <ul className="space-y-3">
                {cat.criteria.map((c) => (
                  <li key={c.key} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {c.title}
                      {c.observable_via && <Badge>{c.observable_via.replace("+", " + ")}</Badge>}
                      {c.guidance_status === "needs_school_definition" && <Badge tone="amber">descriptor to confirm</Badge>}
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400">{c.guidance}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          <Card title="Rating scale">
            <ul className="space-y-2 text-sm">
              {def.rating_scale.map((r) => (
                <li key={r.value}>
                  <span className="font-medium">
                    {r.value} · {r.label}
                  </span>
                  <span className="block text-neutral-500">{r.description}</span>
                </li>
              ))}
              <li>
                <span className="font-medium">{def.not_observed_label}</span>
                <span className="block text-neutral-500">Excluded from the score, never counted as zero, and listed in the report.</span>
              </li>
            </ul>
          </Card>
          <Card title="How scores are calculated">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{def.scoring.method}</p>
          </Card>
          <Card title="Lesson plan alignment">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">A separate percentage, based on the school&apos;s own evaluation prompt:</p>
            <blockquote className="mt-2 border-l-2 border-blue-800 pl-3 text-sm italic">{def.lesson_plan_alignment.school_prompt}</blockquote>
            <p className="mt-2 text-sm text-neutral-500">{def.lesson_plan_alignment.requires}</p>
          </Card>
          <Card title="Changing the framework">
            <p className="text-sm text-neutral-500">
              Edits create a new version, so earlier reports stay tied to the version they were scored with. For the POC, a new version is added in the
              database (see <code>supabase/migrations/…_report_template_v2…sql</code>); an editing screen can come later.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
