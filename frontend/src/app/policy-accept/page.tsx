import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { FileTextIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { consentVersions, POLICY_CONSENT_COOKIE } from "@/lib/policy-consent";
import type { PolicyOverview } from "@/lib/types";
import { PolicyAcceptForm } from "./policy-accept-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("policyAccept.title") };
}

/**
 * ยอมรับนโยบายการใช้งานระบบ — นอก app shell เพราะ API ตอบ 403 policy_required ทุก endpoint
 * ยกเว้น /auth/me, /policy, ยอมรับ, เปลี่ยนรหัสผ่าน, ออกจากระบบ
 * หลายเรื่อง = แสดงทีละเรื่องตามลำดับที่ตั้งไว้ (required[0]) — ยอมรับแล้วกลับมาหน้านี้เองจนครบ (โหมดวันละเรื่อง = 1 เรื่องต่อวัน)
 * ไม่มีเรื่องที่ต้องยอมรับแล้ว = ไปอ่านที่เมนูนโยบายการใช้งาน
 */
export default async function PolicyAcceptPage() {
  const user = await getCurrentUser();
  // ต้องเปลี่ยนรหัสผ่านก่อน (API ยังตอบ password_expired)
  if (user.password_expired) redirect("/login?change=1");
  const [{ data: policy, active, required }, { t }] = await Promise.all([apiFetch<PolicyOverview>("/policy"), getI18n()]);
  if (!active) redirect("/");
  if (!required.length) redirect("/policy");

  // ติ๊กยอมรับฉบับเหล่านี้มาจากหน้า login แล้ว = บันทึกเฉพาะเรื่องที่ต้องยอมรับตอนนี้ให้เลย
  const consented = consentVersions((await cookies()).get(POLICY_CONSENT_COOKIE)?.value);
  const auto = required.filter((v) => consented.includes(v));
  if (auto.length) {
    const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;
    for (const version of auto) await apiFetch("/policy/accept", { method: "POST", body: JSON.stringify({ version, user_agent: userAgent }) });
    redirect("/");
  }

  const current = policy.items.find((i) => i.version === required[0]) ?? policy.items[0];
  const done = policy.items.filter((i) => i.accepted_at).length;

  // กล่องกลางจอ สูง 80% กว้าง 70% ของจอ (จอมือถือเกือบเต็มความกว้าง) — เนื้อหาเลื่อนในกล่อง ปุ่มยอมรับอยู่ท้ายกล่องเสมอ
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex h-[80vh] w-full flex-col gap-4 overflow-hidden rounded-2xl bg-surface p-4 shadow-2xl ring-1 ring-line sm:w-[70vw] sm:p-6">
        <div className="flex shrink-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300">
            <FileTextIcon />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{current.title || t("policyAccept.title")}</h1>
              {policy.items.length > 1 && (
                <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted">{t("policyAccept.step", { current: done + 1, total: policy.items.length })}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">{t("policyAccept.hint", { name: user.name })}</p>
            {policy.pace === "daily" && policy.items.length - done > 1 && <p className="mt-1 text-xs text-faint">{t("policyAccept.dailyHint")}</p>}
          </div>
        </div>
        <PolicyAcceptForm
          key={current.version}
          sections={current.sections}
          previous={current.previous?.sections}
          files={current.files}
          version={current.version}
          accepted={false}
          boxClassName="min-h-0 flex-1"
        />
      </div>
    </main>
  );
}
