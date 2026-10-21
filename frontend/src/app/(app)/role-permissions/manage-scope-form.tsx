"use client";

import { useState, useTransition } from "react";
import { saveManageScope } from "@/app/actions/booking-scope";
import { AppSelect } from "@/components/app-select";
import { AlertIcon, BuildingIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { ManageScope, PermissionGroupRow } from "@/lib/types";

const SCOPES: ManageScope[] = ["all", "branch"];

/**
 * ขอบเขตการจัดการตามสาขา ต่อกลุ่ม — ไม่ตั้ง = ทุกสาขา (เหมือนเดิม)
 * ใช้กับสิทธิ์ที่กระทบคนอื่น: จัดการผู้ใช้ / ดูใบลาทุกคน / อนุมัติลาแทน / วันหยุด-โควตา — เช่น กลุ่ม "HR สาขา" = สาขาตัวเอง
 * ตั้งได้เฉพาะกลุ่มใน editable (admin = กลุ่มที่ต่ำกว่า, อื่นๆ อ่านอย่างเดียว)
 */
export function ManageScopeForm({ groups, initial, editable }: { groups: PermissionGroupRow[]; initial: Record<string, ManageScope>; editable: string[] }) {
  const { t, locale } = useI18n();
  const shown = groups.filter((g) => g.key !== "super_admin");
  const [scopes, setScopes] = useState<Record<string, ManageScope>>(() => Object.fromEntries(shown.map((g) => [g.key, initial[g.key] ?? "all"])));
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();
  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <BuildingIcon width={16} height={16} className="text-accent-500" />
          {t("manageScope.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("manageScope.subtitle")}</p>
      </div>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {shown.map((g) => (
          <label key={g.key} className="text-sm">
            <span className="mb-1 block font-medium">{locale === "th" ? g.name_th : g.name_en}</span>
            <AppSelect
              value={scopes[g.key]}
              disabled={!editable.includes(g.key)}
              onValueChange={(v) => (setScopes({ ...scopes, [g.key]: v as ManageScope }), setResult({}))}
              className={input}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`manageScope.scopes.${s}`)}
                </option>
              ))}
            </AppSelect>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => start(async () => setResult(await saveManageScope(scopes)))} disabled={pending} aria-busy={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("manageScope.save")}
        </button>
      </div>
    </section>
  );
}
