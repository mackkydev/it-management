import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, FileTextIcon } from "@/components/icons";
import { alert, btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { SystemPolicy } from "@/lib/types";
import { PolicyAcceptForm } from "./policy-accept-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("policyAccept.title") };
}

/**
 * ยอมรับนโยบายการใช้งานระบบ (app_settings.system_policy) — นอก app shell เพราะ API ตอบ 403 policy_required ทุก endpoint
 * ยกเว้น /auth/me, /policy, ยอมรับ, เปลี่ยนรหัสผ่าน, ออกจากระบบ — ยอมรับแล้วเปิดหน้านี้ได้ (อ่านอย่างเดียว + วันที่ยอมรับ)
 */
export default async function PolicyAcceptPage() {
  const user = await getCurrentUser();
  // ต้องเปลี่ยนรหัสผ่านก่อน (API ยังตอบ password_expired)
  if (user.password_expired) redirect("/login?change=1");
  const [{ data: policy, active, accepted_at }, { t, fmt }] = await Promise.all([
    apiFetch<{ data: SystemPolicy; active: boolean; accepted_at: string | null }>("/policy"),
    getI18n(),
  ]);
  if (!active) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-5 px-4 py-10">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">
          <FileTextIcon />
        </span>
        <div>
          <h1 className="text-xl font-semibold">{t("policyAccept.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {accepted_at ? t("policyAccept.version", { version: policy.version, date: policy.updated_at ? fmt.dateTime(policy.updated_at) : "-" }) : t("policyAccept.hint", { name: user.name })}
          </p>
        </div>
      </div>
      {accepted_at && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className={alert.success}>
            <CheckCircleIcon className="shrink-0" />
            {t("policyAccept.acceptedOn", { date: fmt.dateTime(accepted_at) })}
          </p>
          <Link href="/" className={btn.secondary}>
            {t("policyAccept.back")}
          </Link>
        </div>
      )}
      <PolicyAcceptForm sections={policy.sections} version={policy.version} accepted={Boolean(accepted_at)} />
    </main>
  );
}
