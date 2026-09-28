"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { createTerm, updateTermEnd, type ActionState } from "./actions";

export function NewTermForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTerm, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
      <Field label="Name">
        <Input name="name" required placeholder="e.g. Spring 2027" />
      </Field>
      <Field label="Starts">
        <Input name="starts_on" type="date" required />
      </Field>
      <Field label="Ends" hint="Videos recorded in this term are deleted after this date.">
        <Input name="ends_on" type="date" required />
      </Field>
      <Button type="submit" disabled={pending}>Add term</Button>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function TermEndForm({ id, endsOn }: { id: string; endsOn: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTermEnd, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="ends_on" type="date" defaultValue={endsOn} className="w-auto" aria-label="Term end date" />
      <Button variant="secondary" disabled={pending}>Save</Button>
      <FormMessage state={state} />
    </form>
  );
}
