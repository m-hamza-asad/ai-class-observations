import AppShell from "@/components/AppShell";
import { requireRole } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/teachers", label: "People" },
  { href: "/admin/terms", label: "Terms" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { profile } = await requireRole("admin");
  return (
    <AppShell nav={NAV} userName={profile.full_name || profile.email} roleLabel="Admin">
      {children}
    </AppShell>
  );
}
