import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Lesson Observation" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getViewer()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-6">
      <div className="mb-8">
        <div className="mb-4 h-10 w-10 rounded-xl bg-blue-800" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Lesson Observation</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in with the email your school registered. No password needed.</p>
      </div>
      {error && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          That sign-in link has expired or was already used. Request a new one below.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
