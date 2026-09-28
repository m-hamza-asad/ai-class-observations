import Link from "next/link";
import type { ReactNode } from "react";
import NavLinks from "./NavLinks";

export default function AppShell({
  nav,
  userName,
  roleLabel,
  children,
}: {
  nav: { href: string; label: string }[];
  userName: string;
  roleLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="h-6 w-6 rounded-md bg-blue-800" aria-hidden />
            Observe
          </Link>
          <NavLinks items={nav} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-500 sm:inline">
              {userName} · {roleLabel}
            </span>
            <form action="/auth/signout" method="post">
              <button className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
