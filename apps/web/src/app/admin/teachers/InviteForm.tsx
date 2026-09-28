"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { inviteUser, type ActionState } from "./actions";

export default function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
      <Field label="Full name">
        <Input name="full_name" required placeholder="e.g. Ayesha Khan" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required placeholder="name@school.edu.pk" />
      </Field>
      <Field label="Role">
        <Select name="role" defaultValue="teacher">
          <option value="teacher">Teacher</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
