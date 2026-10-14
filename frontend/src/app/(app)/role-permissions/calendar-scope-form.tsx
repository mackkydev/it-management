"use client";

import { useState, useTransition } from "react";
import { saveCalendarScope } from "@/app/actions/calendar";
import { AppSelect } from "@/components/app-select";
import { AlertIcon, CalendarIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { CALENDAR_SCOPES, type CalendarScope, type PermissionGroupRow } from "@/lib/types";

/**
 * ขอบเขตการมองเห็นต่อกลุ่ม (ผู้ดูแลระบบสูงสุด) — ไม่ตั้ง = แผนกของตัวเอง
 * kind = calendar: กิจกรรม / งานหน้างาน · leave: วันลาของคนอื่น (ตั้งแยกกัน)
 */
export function CalendarScopeForm({ groups, initial, kind = "calendar" }: { groups: PermissionGroupRow[]; initial: Record<string, CalendarScope>; kind?: "calendar" | "leave" }) {
  const { t, locale } = useI18n();
  const editable = groups.filter((g) => g.key !== "super_admin");
  const [scopes, setScopes] = useState<Record<string, CalendarScope>>(() => Object.fromEntries(editable.map((g) => [g.key, initial[g.key] ?? "department"])));
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarIcon width={16} height={16} className="text-accent-500" />
          {kind === "leave" ? t("calendar.leaveScopeTitle") : t("calendar.scopeTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted">{kind === "leave" ? t("calendar.leaveScopeHint") : t("calendar.scopeHint")}</p>
      </div>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}
      {/* ทุกกลุ่มอยู่บรรทัดเดียวกัน (จอกว้าง) — กลุ่มเยอะเกินความกว้างค่อยขึ้นบรรทัดใหม่ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {editable.map((g) => (
          <label key={g.key} className="text-sm">
            <span className="mb-1 block font-medium">{locale === "th" ? g.name_th : g.name_en}</span>
            <AppSelect value={scopes[g.key]} onValueChange={(v) => (setScopes({ ...scopes, [g.key]: v as CalendarScope }), setResult({}))} className={input}>
              {CALENDAR_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`calendar.scopes.${s}`)}
                </option>
              ))}
            </AppSelect>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => start(async () => setResult(await saveCalendarScope(scopes, kind)))} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("calendar.scopeSave")}
        </button>
      </div>
    </section>
  );
}
