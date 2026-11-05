import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { has, getCurrentUser, getUiConfig } from "@/lib/auth";
import type { AppSettings, PermissionCatalog, SystemPolicy } from "@/lib/types";
import { LogoCard } from "./logo-card";
import { SecurityForm } from "./security-form";
import { SettingsForm } from "./settings-form";
import { PasswordPolicyForm } from "./password-policy-form";
import { TwoFactorPolicy } from "./two-factor-policy";
import { SignaturePolicy } from "./signature-policy";
import { PolicyOptions } from "./policy-options";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settingsPage.title") };
}

/** 5.2 ตั้งค่าการแจ้งเตือนล่วงหน้า + อีเมลรับแจ้งเตือน (admin) */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!has(user, "settings.manage")) redirect("/tickets");
  const [{ data }, { t }, ui, policy] = await Promise.all([
    apiFetch<{ data: AppSettings }>("/settings"),
    getI18n(),
    getUiConfig(),
    apiFetch<{ data: SystemPolicy }>("/policy"),
  ]);
  const groups = has(user, "access.manage") ? (await apiFetch<PermissionCatalog>("/permissions")).groups : null;

  return (
    <div className="space-y-5">
      <PageHeader icon={SettingsIcon} title={t("settingsPage.title")} subtitle={t("settingsPage.subtitle")} />
      <LogoCard version={ui.logo_version} />
      <SettingsForm initial={data} />
      <SecurityForm
        initial={data.secret_guard}
        pinStatus={data.secret_pin_status}
        canManagePin={has(user, "secrets.pin_manage")}
        userOptions={data.secret_notify_options}
        effectiveRecipients={data.secret_notify_effective}
      />
      {/* การ์ดเล็กวางคู่กัน ไม่ต้องกินเต็มแถว */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* นโยบายการใช้งานระบบที่ต้องยอมรับก่อนใช้งาน + รายชื่อผู้ยอมรับ (settings.manage) */}
        <PolicyOptions initial={policy.data} />
        {/* บังคับลายเซ็นก่อนบันทึก/อนุมัติเอกสาร (หน้านี้ = settings.manage) */}
        <SignaturePolicy initial={Boolean(data.require_signature)} />
      </div>
      {/* บังคับ 2FA ตามกลุ่ม — นโยบายการเข้าสู่ระบบ (access.manage) */}
      {groups && <TwoFactorPolicy groups={groups} initial={data.two_factor_groups ?? []} />}
      {/* นโยบายรหัสผ่าน: ล็อกบัญชีเมื่อ login ผิด + บังคับเปลี่ยนรหัสผ่านทุก N วัน + ล็อกเมื่อไม่เข้าระบบรายกลุ่ม (access.manage) */}
      {groups && <PasswordPolicyForm initial={data.password_policy} groups={groups} />}
    </div>
  );
}
