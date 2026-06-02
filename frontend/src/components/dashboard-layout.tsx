import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/auth/auth-gate";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AuthGate>{children}</AuthGate>
    </AppShell>
  );
}
