import AppShell from "@/components/AppShell";
import { requireRole } from "@/lib/auth";

const NAV = [{ href: "/teacher", label: "My classes" }];

export default async function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  const { profile } = await requireRole("teacher");
  return (
    <AppShell nav={NAV} userName={profile.full_name || profile.email} roleLabel="Teacher">
      {children}
    </AppShell>
  );
}
