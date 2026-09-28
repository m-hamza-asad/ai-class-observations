"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { resendInvite, setActive, type ActionState } from "./actions";

export default function RowActions({ userId, invited, active, isSelf }: { userId: string; invited: boolean; active: boolean; isSelf: boolean }) {
  const [resendState, resend, resending] = useActionState<ActionState, FormData>(resendInvite, null);
  const [activeState, toggle, toggling] = useActionState<ActionState, FormData>(setActive, null);
  const msg = resendState ?? activeState;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {invited && active && (
        <form action={resend}>
          <input type="hidden" name="userId" value={userId} />
          <Button variant="secondary" disabled={resending}>{resending ? "Sending…" : "Resend invite"}</Button>
        </form>
      )}
      {!isSelf && (
        <form action={toggle}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="activate" value={active ? "0" : "1"} />
          <Button variant={active ? "danger" : "secondary"} disabled={toggling}>{active ? "Deactivate" : "Reactivate"}</Button>
        </form>
      )}
      {msg && <span className={`w-full text-right text-xs ${msg.error ? "text-red-600" : "text-green-700"}`}>{msg.error ?? msg.ok}</span>}
    </div>
  );
}
