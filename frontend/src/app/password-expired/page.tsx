import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { LockIcon, LogoutIcon } from "@/components/icons";
import { alert, btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { PasswordForm } from "../(app)/profile/profile-forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("passwordExpired.title") };
}

/**
 * รหัสผ่านหมดอายุตามนโยบายรหัสผ่าน (หน้าตั้งค่าระบบ) — นอก app shell เพราะ API ตอบ 403 password_expired ทุก endpoint
 * ยกเว้น /auth/me, เปลี่ยนรหัสผ่าน, ออกจากระบบ (apiFetch พามาหน้านี้) — เปลี่ยนสำเร็จแล้วกลับเข้าใช้งานต่อ
 */
export default async function PasswordExpiredPage() {
  const user = await getCurrentUser();
  if (!user.password_expired) redirect("/");
  const { t, fmt } = await getI18n();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-5 px-4 py-10">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warning-100 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300">
          <LockIcon />
        </span>
        <div>
          {/* เข้าสู่ระบบครั้งแรก / ผู้ดูแลรีเซ็ตรหัสผ่าน (นโยบายบังคับเปลี่ยนครั้งแรก) หรือรหัสผ่านหมดอายุตามรอบ */}
          <h1 className="text-xl font-semibold">{t(user.password_change_required ? "passwordExpired.firstTitle" : "passwordExpired.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t(user.password_change_required ? "passwordExpired.firstHint" : "passwordExpired.hint", { name: user.name })}</p>
        </div>
      </div>
      {!user.password_change_required && user.password_expires_at && (
        <p role="status" className={alert.warning}>
          {t("passwordExpired.expiredOn", { date: fmt.dateTime(user.password_expires_at) })}
        </p>
      )}
      <PasswordForm redirectTo="/" />
      <form action={logout} className="flex justify-end">
        <button type="submit" className={btn.secondary}>
          <LogoutIcon width={16} height={16} />
          {t("passwordExpired.logout")}
        </button>
      </form>
    </main>
  );
}
