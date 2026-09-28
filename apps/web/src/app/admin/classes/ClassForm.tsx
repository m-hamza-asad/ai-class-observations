"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { createClass, updateClass, type ActionState } from "./actions";

interface Props {
  teachers: { id: string; full_name: string; email: string }[];
  initial?: { id: string; name: string; subject: string | null; grade: string | null; teacher_id: string | null };
  /** single-column layout for narrow side panels */
  compact?: boolean;
}

export default function ClassForm({ teachers, initial, compact }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(initial ? updateClass : createClass, null);
  return (
    <form action={action} className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr_auto] lg:items-end"}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Class name">
        <Input name="name" required defaultValue={initial?.name} placeholder="e.g. Grade 7 Blue" />
      </Field>
      <Field label="Subject">
        <Input name="subject" defaultValue={initial?.subject ?? ""} placeholder="e.g. Science" />
      </Field>
      <Field label="Grade">
        <Input name="grade" defaultValue={initial?.grade ?? ""} placeholder="e.g. 7" />
      </Field>
      <Field label="Teacher">
        <Select name="teacher_id" defaultValue={initial?.teacher_id ?? ""}>
          <option value="">Unassigned</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name || t.email}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : initial ? "Save" : "Create class"}</Button>
      <div className={compact ? "" : "sm:col-span-2 lg:col-span-5"}>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
