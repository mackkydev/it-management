import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UserIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { PrefsControls } from "@/components/shell/prefs-controls";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { PasswordForm, ProfileForm, SignatureCard } from "./profile-forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("profile.title") };
}

export default async function ProfilePage() {
  // getCurrentUser = GET /auth/me (ข้อมูลผู้ใช้ทั้งหมดจาก API รวมสังกัด/หัวหน้า/สิทธิ์ IT/ลายเซ็น)
  const [user, { t, fmt }] = await Promise.all([getCurrentUser(), getI18n()]);
  const yes = (v?: boolean) => (v ? t("profile.yes") : t("profile.no"));

  const rows: { label: string; value: ReactNode }[] = [
    { label: t("profile.name"), value: user.name },
    { label: t("profile.email"), value: user.email },
    { label: t("profile.role"), value: t(`roles.${user.role}`) },
    { label: t("profile.branch"), value: user.branch?.name },
    { label: t("profile.department"), value: user.department },
    { label: t("profile.division"), value: user.division },
    { label: t("profile.supervisor"), value: user.supervisor?.name },
    { label: t("profile.itStaff"), value: yes(user.is_it_staff) },
    { label: t("profile.itHead"), value: yes(user.is_it_head) },
    { label: t("profile.memberSince"), value: user.created_at ? fmt.date(user.created_at) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader icon={UserIcon} title={t("profile.title")} subtitle={user.email} />
      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <section className={`p-4 sm:p-6 ${card}`}>
            <div className="mb-4">
              <h2 className="font-semibold">{t("profile.details")}</h2>
              <p className="mt-1 text-sm text-muted">{t("profile.detailsHint")}</p>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <div key={r.label}>
                  <dt className="text-xs text-muted">{r.label}</dt>
                  <dd className="mt-0.5 font-medium text-ink">{r.value || "-"}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <ProfileForm user={user} />
            <SignatureCard url={user.signature_url ?? null} />
          </div>
          {user.type === "API" ? (
            // API User: รหัสผ่านอยู่ที่ระบบต้นทาง — ระบบเราเปลี่ยนให้ไม่ได้
            <section className={`p-4 sm:p-6 ${card}`}>
              <h2 className="font-semibold">{t("profile.passwordTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("profile.externalPassword", { name: user.external_connection?.name ?? "-" })}</p>
              {user.external_connection?.change_password_url && (
                <a
                  href={user.external_connection.change_password_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block cursor-pointer text-sm font-medium text-accent-600 hover:underline dark:text-accent-300"
                >
                  {t("profile.changeAtSource")}
                </a>
              )}
            </section>
          ) : (
            <PasswordForm />
          )}
        </div>
        <section className={`h-fit p-4 sm:p-6 ${card}`}>
          <h2 className="mb-4 font-semibold">{t("prefs.title")}</h2>
          <PrefsControls />
        </section>
      </div>
    </div>
  );
}
