"use client";

import { useState } from "react";
import { AlertIcon, CheckIcon, SpinnerIcon } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { alert, btn, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { overlaps, periodText } from "./vehicle-utils";

/**
 * จัดคิวรถ: รถที่เลือกไม่ว่าง → กล่องรายชื่อรถทั้งหมดให้เลือกใหม่ (เลือกคันที่ไม่ว่างได้ = สลับรถ / ดึงรถมาจากการจองนั้น)
 * busy = การจองอื่น (รออนุมัติ + อนุมัติแล้ว) ใช้บอกว่าคันไหนติดการจองของใคร — API ตรวจซ้ำและตัดสินว่าสลับหรือดึงรถ
 */
export function VehiclePickerModal({
  booking,
  vehicles,
  busy,
  initial,
  message,
  error,
  pending,
  onPick,
  onClose,
}: {
  booking: VehicleBooking;
  vehicles: Vehicle[];
  busy: VehicleBooking[];
  initial: number | null;
  message?: string;
  error?: string;
  pending: boolean;
  onPick: (vehicleId: number) => void;
  onClose: () => void;
}) {
  const { t, fmt } = useI18n();
  const [picked, setPicked] = useState<number | null>(initial);
  const holders = (vehicleId: number) =>
    busy.filter((x) => x.id !== booking.id && x.vehicle?.id === vehicleId && (x.status === "pending" || x.status === "confirmed") && overlaps(x, booking));
  const chosenBusy = picked !== null && holders(picked).length > 0;

  return (
    <ModalShell id="vehicle-picker" title={t("vehicle.dispatch.picker.title")} subtitle={t("vehicle.dispatch.picker.hint")} onClose={onClose} busy={pending} size="lg">
      <div className="space-y-3 overflow-y-auto px-5 py-4">
        {message && <p className={alert.warning}>{message}</p>}
        <ul role="radiogroup" aria-label={t("vehicle.dispatch.picker.title")} className="space-y-2">
          {vehicles.map((v) => {
            const taken = holders(v.id);
            const on = picked === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(v.id)}
                  className={`flex w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${on ? "bg-accent-50 ring-accent-400 dark:bg-accent-400/10" : "ring-line hover:bg-subtle"}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${on ? "bg-accent-500 text-white ring-accent-500" : "ring-line"}`}>
                    {on && <CheckIcon width={10} height={10} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {v.name}
                      {v.plate_no && <span className="text-xs font-normal text-muted">{v.plate_no}</span>}
                      <span className="text-xs font-normal text-muted">{t("vehicle.seats", { n: v.seats })}</span>
                      {booking.vehicle?.id === v.id && <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${tone.info.badge}`}>{t("vehicle.dispatch.picker.current")}</span>}
                    </span>
                    {taken.length === 0 ? (
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone.success.badge}`}>{t("vehicle.dispatch.picker.free")}</span>
                    ) : (
                      taken.map((x) => (
                        <span key={x.id} className={`mt-1 mr-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone.warning.badge}`}>
                          {t("vehicle.dispatch.picker.busyBy", { owner: x.user.name, period: periodText(x, fmt.date) })}
                        </span>
                      ))
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {chosenBusy && <p className="text-xs text-muted">{t("vehicle.dispatch.picker.swapNote")}</p>}
        {error && (
          <p role="alert" className={alert.error}>
            <AlertIcon className="shrink-0" />
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={onClose} disabled={pending} className={`${btn.secondary} disabled:cursor-not-allowed`}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => picked !== null && onPick(picked)}
          disabled={pending || picked === null}
          aria-busy={pending}
          className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {pending ? <SpinnerIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
          {t("vehicle.dispatch.assign")}
        </button>
      </div>
    </ModalShell>
  );
}
