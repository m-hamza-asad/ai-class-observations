"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { removeDocument, retryDocumentParse, type ActionState } from "../actions";

export default function DocumentActions({ documentId, canRetry }: { documentId: string; canRetry: boolean }) {
  const [retryState, retry, retrying] = useActionState<ActionState, FormData>(retryDocumentParse, null);
  const [removeState, remove, removing] = useActionState<ActionState, FormData>(removeDocument, null);
  const msg = retryState?.error ?? removeState?.error;
  return (
    <div className="flex items-center gap-2">
      {canRetry && (
        <form action={retry}>
          <input type="hidden" name="documentId" value={documentId} />
          <Button variant="secondary" disabled={retrying}>{retrying ? "Retrying…" : "Retry"}</Button>
        </form>
      )}
      <form
        action={remove}
        onSubmit={(e) => {
          if (!confirm("Remove this document? Existing reports keep their reference to it; future rubrics won't use it.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="documentId" value={documentId} />
        <Button variant="ghost" disabled={removing}>Remove</Button>
      </form>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
