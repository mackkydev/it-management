import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser, getUiConfig } from "@/lib/auth";
import { getPrefs } from "@/lib/prefs-server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, prefs, uiConfig] = await Promise.all([getCurrentUser(), getPrefs(), getUiConfig()]);

  return (
    <AppShell layout={prefs.layout} user={user} uiConfig={uiConfig}>
      {children}
    </AppShell>
  );
}
