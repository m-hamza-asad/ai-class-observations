"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok?: string; error?: string } | null;

const termSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a term name."),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
  })
  .refine((t) => t.ends_on > t.starts_on, { message: "The end date must be after the start date." });

export async function createTerm(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await assertAdmin();
  const parsed = termSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("academic_terms").insert({ ...parsed.data, campus_id: admin.campus_id });
  if (error) return { error: error.message };
  revalidatePath("/admin/terms");
  revalidatePath("/admin");
  return { ok: "Term added." };
}

export async function updateTermEnd(_prev: ActionState, form: FormData): Promise<ActionState> {
  await assertAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const ends_on = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(form.get("ends_on"));
  if (!ends_on.success) return { error: "Pick a valid date." };
  const supabase = await createClient();
  const { error } = await supabase.from("academic_terms").update({ ends_on: ends_on.data }).eq("id", id);
  if (error) return { error: error.message.includes("check") ? "The end date must be after the start date." : error.message };
  revalidatePath("/admin/terms");
  return { ok: "Saved. Applies to recordings made from now on." };
}
