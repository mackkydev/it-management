"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignVehicle } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useAlert } from "@/components/dialog-provider";
import { EyeIcon, GaugeIcon, PencilIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { btn, card, input, table, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { IDLE_TONE } from "@/lib/booking";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleDialog } from "./vehicle-dialog";
import { overlaps, periodText, toneOf } from "./vehicle-utils";

/**
 * รายการการจองรถ — mode mine = การจองของฉัน (แก้ไข / รายละเอียด + ยกเลิก ลบ บันทึกเลขไมล์ในกล่องรายละเอียด),
 * mode dispatch = ผู้จัดคิวรถเลือกรถในแถว (รถที่ไม่ว่างในช่วงนั้นมีป้ายบอก — busy = การจองอื่นที่ใช้ตรวจ)
 */
export function VehicleBookingList({ items, vehicles, mode, busy = [] }: { items: VehicleBooking[]; vehicles: Vehicle[]; mode: "mine" | "dispatch"; busy?: VehicleBooking[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const showAlert = useAlert();
  const [selected, setSelected] = useState<VehicleBooking | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [, start] = useTransition();

  const toneFor = (b: VehicleBooking) => (b.vehicle ? toneOf(vehicles, b.vehicle.id) : IDLE_TONE);
  const status = (b: VehicleBooking) => {
    const [cls, key] = b.status === "cancelled" ? [tone.idle.badge, "cancelled"] : b.is_over ? [tone.info.badge, "over"] : [tone.success.badge, "confirmed"];
    return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`meeting.booking.statuses.${key as "confirmed" | "cancelled" | "over"}`)}</span>;
  };
  const vehicleCell = (b: VehicleBooking) => (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneFor(b).bar}`}>{b.vehicle ? `${b.vehicle.name}${b.vehicle.plate_no ? ` · ${b.vehicle.plate_no}` : ""}` : t("vehicle.unassigned")}</span>
  );
  const mileage = (b: VehicleBooking) =>
    b.vehicle && (b.start_mileage !== null || b.end_mileage !== null) ? (
      <span className="flex items-center gap-1 text-xs text-muted">
        <GaugeIcon width={12} height={12} />
        {b.start_mileage === null ? "-" : fmt.number(b.start_mileage)} → {b.end_mileage === null ? "-" : fmt.number(b.end_mileage)}
      </span>
    ) : null;

  const assign = (b: VehicleBooking) => {
    const value = choice[b.id] ?? (b.vehicle ? String(b.vehicle.id) : "");
    setSaving(b.id);
    start(async () => {
      const res = await assignVehicle(b.id, value ? Number(value) : null);
      setSaving(null);
      if (!res.ok) return void (await showAlert(res.errors?.vehicle_id ?? res.message ?? t("common.saveFailed")));
      router.refresh();
    });
  };
  const assignControl = (b: VehicleBooking) => {
    const value = choice[b.id] ?? (b.vehicle ? String(b.vehicle.id) : "");
    const others = busy.filter((x) => x.id !== b.id && x.vehicle);
    return (
      <div className="flex min-w-64 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <AppSelect value={value} onValueChange={(x) => setChoice((c) => ({ ...c, [b.id]: x }))} className={`${input} py-1.5 text-sm`} aria-label={t("vehicle.form.vehicle")}>
            <option value="">{t("vehicle.unassigned")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {`${v.name} · ${t("vehicle.seats", { n: v.seats })}${others.some((x) => x.vehicle!.id === v.id && overlaps(x, b)) ? ` — ${t("vehicle.form.vehicleBusy")}` : ""}`}
              </option>
            ))}
          </AppSelect>
        </div>
        <button type="button" disabled={saving === b.id || value === (b.vehicle ? String(b.vehicle.id) : "")} onClick={() => assign(b)} className={`${btn.primary} ${btn.sm} shrink-0`}>
          {saving === b.id ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
          {t("vehicle.dispatch.assign")}
        </button>
      </div>
    );
  };
  const actions = (b: VehicleBooking) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {mode === "mine" && b.can_edit && (
        <Link href={`/vehicles/bookings/${b.id}/edit`} className={`${btn.soft} ${btn.sm} whitespace-nowrap`}>
          <PencilIcon width={14} height={14} />
          {t("meeting.booking.edit")}
        </Link>
      )}
      <button type="button" onClick={() => setSelected(b)} className={`${btn.secondary} ${btn.sm} whitespace-nowrap`}>
        {b.can_mileage && mode === "mine" ? <GaugeIcon width={14} height={14} /> : <EyeIcon width={14} height={14} />}
        {b.can_mileage && mode === "mine" ? t("vehicle.mileage.record") : t("vehicle.detail.details")}
      </button>
    </div>
  );

  return (
    <>
      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("vehicle.detail.when")}</th>
              <th className={table.th}>{t("vehicle.detail.details")}</th>
              <th className={table.th}>{t("vehicle.detail.vehicle")}</th>
              {mode === "dispatch" && <th className={table.th}>{t("meeting.detail.booker")}</th>}
              <th className={table.th} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((b) => (
              <tr key={b.id} className={table.row}>
                <td className={`${table.td} whitespace-nowrap`}>
                  <Link href={`/vehicles/day/${b.start_on}`} className="cursor-pointer font-medium hover:text-accent-600 dark:hover:text-accent-300">
                    {periodText(b, fmt.date)}
                  </Link>
                  <span className="mt-1 block">{status(b)}</span>
                </td>
                <td className={table.td}>
                  <span className="block font-medium">{b.details}</span>
                  <span className="block text-xs text-muted">
                    {b.purpose} · {t("vehicle.detail.passengersValue", { n: fmt.number(b.passengers) })}
                    {b.extras.length > 0 && ` · ${b.extras.join(", ")}`}
                  </span>
                </td>
                <td className={table.td}>
                  {mode === "dispatch" && b.can_assign ? assignControl(b) : vehicleCell(b)}
                  {mileage(b)}
                </td>
                {mode === "dispatch" && (
                  <td className={table.td}>
                    {b.user.name}
                    {b.department && <span className="block text-xs text-muted">{b.department}</span>}
                    {/* สาขาที่ขอใช้รถ (ผู้จัดคิวของสาขานี้เลือกรถ) */}
                    {b.branch && <span className="block text-xs text-muted">{b.branch.name}</span>}
                  </td>
                )}
                <td className={table.td}>{actions(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map((b) => (
          <li key={b.id} className={`space-y-2 p-4 ${card}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-medium">{b.details}</p>
              {status(b)}
            </div>
            <p className="text-sm">{periodText(b, fmt.date)}</p>
            {mode === "dispatch" && <p className="text-xs text-muted">{[b.user.name, b.branch?.name].filter(Boolean).join(" · ")}</p>}
            {mode === "dispatch" && b.can_assign ? assignControl(b) : vehicleCell(b)}
            {mileage(b)}
            {actions(b)}
          </li>
        ))}
      </ul>

      {selected && (
        <VehicleDialog
          booking={selected}
          tone={toneFor(selected)}
          vehicles={mode === "dispatch" ? vehicles : []}
          onClose={() => setSelected(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </>
  );
}
