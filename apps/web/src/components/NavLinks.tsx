"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
      {items.map((it) => {
        const active = it.href === path || (it.href !== "/admin" && it.href !== "/teacher" && path.startsWith(it.href));
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${active ? "bg-blue-50 font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
