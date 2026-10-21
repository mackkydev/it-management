"use client";

import { useState, useTransition } from "react";
import { saveBookingScope } from "@/app/actions/booking-scope";
import { AppSelect } from "@/components/app-select";
import { AlertIcon, BuildingIcon, CheckCircleIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { alert, btn, card, input } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { BookingKind, BookingScope, PermissionGroupRow } from "@/lib/types";

const KINDS: BookingKind[] = ["meeting", "vehicle"];
const SCOPES: BookingScope[] = ["all", "branch"];
type Settings = Record<BookingKind, Record<string, BookingScope>>;

/**
 * ห้องประชุม / รถ ตามสาขา ต่อกลุ่ม — ไม่ตั้ง = ทุกสาขา · ตั้งได้เฉพาะกลุ่มใน editable (admin = กลุ่มที่ต่ำกว่า)
 * จอกว้าง = ตาราง กลุ่ม × (ห้องประชุม, รถ) / มือถือ = การ์ดต่อกลุ่ม
 */
export function BookingScopeForm({ groups, initial, editable: canEdit }: { groups: PermissionGroupRow[]; initial: Settings; editable: string[] }) {
  const { t, locale } = useI18n();
  const editable = groups.filter((g) => g.key !== "super_admin");
  const [scopes, setScopes] = useState<Settings>(() => ({
    meeting: Object.fromEntries(editable.map((g) => [g.key, initial.meeting[g.key] ?? "all"])),
    vehicle: Object.fromEntries(editable.map((g) => [g.key, initial.vehicle[g.key] ?? "all"])),
  }));
  const [result, setResult] = useState<{ ok?: boolean; message?: string }>({});
  const [pending, start] = useTransition();

  const select = (kind: BookingKind, key: string) => (
    <AppSelect
      value={scopes[kind][key]}
      disabled={!canEdit.includes(key)}
      onValueChange={(v) => (setScopes((s) => ({ ...s, [kind]: { ...s[kind], [key]: v as BookingScope } })), setResult({}))}
      aria-label={t(`bookingScope.${kind}`)}
      className={input}
    >
      {SCOPES.map((s) => (
        <option key={s} value={s}>
          {t(`bookingScope.scopes.${s}`)}
        </option>
      ))}
    </AppSelect>
  );

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <BuildingIcon width={16} height={16} className="text-accent-500" />
          {t("bookingScope.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("bookingScope.subtitle")}</p>
      </div>
      {result.message && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? alert.success : alert.error}>
          {result.ok ? <CheckCircleIcon className="shrink-0 text-success-500" /> : <AlertIcon className="shrink-0 text-danger-400" />}
          {result.message}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {editable.map((g) => (
          <div key={g.key} className="space-y-2 rounded-xl bg-subtle p-3">
            <p className="text-sm font-medium">{locale === "th" ? g.name_th : g.name_en}</p>
            {KINDS.map((kind) => (
              <div key={kind} className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-sm">
                <span className="text-muted">{t(`bookingScope.${kind}`)}</span>
                {select(kind, g.key)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => start(async () => setResult(await saveBookingScope(scopes)))} disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("bookingScope.save")}
        </button>
      </div>
    </section>
  );
}
