import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { LoginDigest } from "@/components/shell/login-digest";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, getUiConfig } from "@/lib/auth";
import { getPrefs } from "@/lib/prefs-server";
import type { AppNotification, PublicAnnouncement, TicketCounts } from "@/lib/types";
import { WELCOME_COOKIE } from "@/lib/welcome";

/** หลัง login: การแจ้งเตือนที่ยังไม่อ่าน + งานรออนุมัติ + ประกาศ — null = ไม่มีอะไรต้องแสดง */
async function loginDigest() {
  if (!(await cookies()).has(WELCOME_COOKIE)) return null;
  try {
    const [notes, tickets, announcements] = await Promise.all([
      apiFetch<{ data: AppNotification[]; unread_count: number }>("/notifications?per_page=15"),
      apiFetch<{ counts: TicketCounts }>("/tickets?scope=approvals&per_page=1"),
      // ประกาศจากฝ่าย IT — แสดงเป็นกล่องข้างการแจ้งเตือน (ดึงไม่ได้ก็ไม่แสดงกล่องนี้)
      apiFetch<{ data: PublicAnnouncement[] }>("/announcements/public").then((r) => r.data, () => []),
    ]);
    const approvals = tickets.counts.approvals ?? 0;
    return notes.unread_count > 0 || approvals > 0 || announcements.length > 0
      ? { items: notes.data, unread: notes.unread_count, approvals, announcements }
      : null;
  } catch {
    return null; // สรุปไม่ได้ก็เข้าใช้งานต่อได้ตามปกติ
  }
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [user, prefs, uiConfig, digest] = await Promise.all([getCurrentUser(), getPrefs(), getUiConfig(), loginDigest()]);

  return (
    <AppShell layout={prefs.layout} user={user} uiConfig={uiConfig}>
      <LiveRefresh />
      {digest && <LoginDigest {...digest} />}
      {children}
    </AppShell>
  );
}
