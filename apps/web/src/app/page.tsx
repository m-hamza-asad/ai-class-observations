import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";

export default async function Home() {
  if (supabaseConfigured) {
    const viewer = await getViewer();
    if (!viewer) redirect("/login");
    if (!viewer.profile) redirect("/no-access");
    redirect(viewer.profile.role === "admin" ? "/admin" : "/teacher");
  }
  // Before Supabase is configured, only the recording lab is available.
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Lesson Observation</h1>
      <p className="text-neutral-500">Supabase isn&apos;t configured yet. Only the recording lab is available.</p>
      <Link href="/lab/recorder" className="inline-block rounded-md bg-blue-800 px-4 py-2 font-medium text-white">
        Open recording lab
      </Link>
    </main>
  );
}
