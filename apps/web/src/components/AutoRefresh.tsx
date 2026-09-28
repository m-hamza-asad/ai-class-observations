"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component tree on an interval while `active` (e.g. documents still parsing). */
export default function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
