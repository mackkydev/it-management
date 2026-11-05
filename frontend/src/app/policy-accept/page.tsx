import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { CheckCircleIcon, FileTextIcon, PrinterIcon } from "@/components/icons";
import { PolicyFiles } from "@/components/policy-content";
import { alert, btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { POLICY_CONSENT_COOKIE } from "@/lib/policy-consent";
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
  // ติ๊กยอมรับฉบับนี้มาจากหน้า login แล้ว = บันทึกให้เลย
  if (!accepted_at && (await cookies()).get(POLICY_CONSENT_COOKIE)?.value === String(policy.version)) {
    await apiFetch("/policy/accept", { method: "POST", body: JSON.stringify({ version: policy.version, user_agent: (await headers()).get("user-agent")?.slice(0, 255) ?? null }) });
    redirect("/");
  }

  // กล่องกลางจอ สูง 80% กว้าง 70% ของจอ (จอมือถือเกือบเต็มความกว้าง) — เนื้อหาเลื่อนในกล่อง ปุ่มยอมรับอยู่ท้ายกล่องเสมอ
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex h-[80vh] w-full flex-col gap-4 overflow-hidden rounded-2xl bg-surface p-4 shadow-2xl ring-1 ring-line sm:w-[70vw] sm:p-6">
        <div className="flex shrink-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">
            <FileTextIcon />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{policy.title || t("policyAccept.title")}</h1>
            <p className="mt-1 text-sm text-muted">
              {accepted_at ? t("policyAccept.version", { version: policy.version, date: policy.updated_at ? fmt.dateTime(policy.updated_at) : "-" }) : t("policyAccept.hint", { name: user.name })}
            </p>
          </div>
        </div>
        {accepted_at && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <p role="status" className={alert.success}>
              <CheckCircleIcon className="shrink-0" />
              {t("policyAccept.acceptedOn", { date: fmt.dateTime(accepted_at) })}
            </p>
            <span className="flex flex-wrap gap-2">
              <a href={`/policy-print/${user.id}?version=${policy.version}`} target="_blank" rel="noreferrer" className={btn.secondary}>
                <PrinterIcon />
                {t("policyAccept.myDocument")}
              </a>
              <Link href="/" className={btn.secondary}>
                {t("policyAccept.back")}
              </Link>
            </span>
          </div>
        )}
        {policy.files.length > 0 && (
          <section className="max-h-32 shrink-0 overflow-y-auto">
            <h2 className="mb-2 text-sm font-medium">{t("login_policy.files")}</h2>
            <PolicyFiles files={policy.files} />
          </section>
        )}
        <PolicyAcceptForm sections={policy.sections} version={policy.version} accepted={Boolean(accepted_at)} boxClassName="min-h-0 flex-1" />
      </div>
    </main>
  );
}
