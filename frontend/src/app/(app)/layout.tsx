import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertIcon } from "@/components/icons";
import { alert } from "@/components/ui";
import { getI18n } from "@/i18n/server";
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
  const [user, prefs, uiConfig, digest, { t, fmt }] = await Promise.all([getCurrentUser(), getPrefs(), getUiConfig(), loginDigest(), getI18n()]);
  // รหัสผ่านหมดอายุ (นโยบายรหัสผ่าน) — API ตอบ 403 แทบทุก endpoint จนกว่าจะเปลี่ยน (apiFetch ก็พาไปหน้าเดียวกัน)
  if (user.password_expired) redirect("/password-expired");

  return (
    <AppShell layout={prefs.layout} user={user} uiConfig={uiConfig}>
      <LiveRefresh />
      {user.password_warn && user.password_expires_at && (
        <p role="status" className={`${alert.warning} mb-4 flex-wrap`}>
          <AlertIcon className="shrink-0" />
          {t("passwordExpired.warn", { date: fmt.date(user.password_expires_at) })}
          <Link href="/profile" className="cursor-pointer font-medium underline underline-offset-2">
            {t("passwordExpired.changeNow")}
          </Link>
        </p>
      )}
      {digest && <LoginDigest {...digest} />}
      {children}
    </AppShell>
  );
}
