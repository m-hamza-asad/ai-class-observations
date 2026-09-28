"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { sendMagicLink, type LoginState } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <Input type="email" name="email" autoComplete="email" inputMode="email" required placeholder="you@school.edu.pk" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
