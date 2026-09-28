import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import RecorderClient from "./RecorderClient";

export const metadata = { title: "Record lesson · Observe" };

export default async function RecordPage({ searchParams }: PageProps<"/teacher/record">) {
  await requireRole("teacher");
  const { class: classId } = await searchParams;
  if (typeof classId !== "string") notFound();
  const supabase = await createClient();
  // RLS: only returns the class if it's this teacher's
  const { data: cls } = await supabase.from("classes").select("id, name").eq("id", classId).maybeSingle();
  if (!cls) notFound();
  return <RecorderClient classId={cls.id} className={cls.name} />;
}
