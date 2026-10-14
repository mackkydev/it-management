"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { assignVehicle, cancelVehicleBooking, deleteVehicleBooking, saveMileage } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useAlert, useConfirm } from "@/components/dialog-provider";
import { CarIcon, GaugeIcon, PencilIcon, SaveIcon, SpinnerIcon, TrashIcon, XIcon } from "@/components/icons";
import { btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Tone } from "@/lib/booking";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { periodText } from "./vehicle-utils";

/**
 * รายละเอียดการจองรถ (กล่องลอย) — แก้ไข / ยกเลิก / ลบ (เจ้าของหรือผู้จัดคิว), บันทึกเลขไมล์ (มีรถแล้ว),
 * เลือกรถ (ผู้จัดคิวรถ — ส่ง vehicles มาเมื่อมีสิทธิ์)
 */
export function VehicleDialog({
  booking: initial,
  tone,
  vehicles = [],
  onClose,
  onChanged,
}: {
  booking: VehicleBooking;
  tone: Tone;
  vehicles?: Vehicle[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, fmt } = useI18n();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [b, setB] = useState(initial);
  const [pending, start] = useTransition();
  const [mileage, setMileage] = useState({ start: b.start_mileage?.toString() ?? "", end: b.end_mileage?.toString() ?? "" });
  const [mileageError, setMileageError] = useState("");
  const [vehicleId, setVehicleId] = useState(b.vehicle ? String(b.vehicle.id) : "");
  const [assignError, setAssignError] = useState("");
  const period = periodText(b, fmt.date);

  const act = async (kind: "cancel" | "delete") => {
    if (!(await confirm(t(kind === "cancel" ? "vehicle.booking.confirmCancel" : "vehicle.booking.confirmDelete", { period })))) return;
    start(async () => {
      const res = kind === "cancel" ? await cancelVehicleBooking(b.id) : await deleteVehicleBooking(b.id);
      if (!res.ok) return void (await showAlert(res.message ?? t("common.saveFailed")));
      onChanged();
      onClose();
    });
  };
  const recordMileage = () => {
    if (mileage.start && mileage.end && Number(mileage.end) < Number(mileage.start)) return setMileageError(t("vehicle.form.validate.mileage"));
    start(async () => {
      const res = await saveMileage(b.id, mileage.start, mileage.end);
      if (res.booking) {
        setB(res.booking);
        setMileageError("");
        onChanged();
      } else setMileageError(res.errors?.end_mileage ?? res.errors?.start_mileage ?? res.message ?? "");
    });
  };
  const assign = () =>
    start(async () => {
      const res = await assignVehicle(b.id, vehicleId ? Number(vehicleId) : null);
      if (res.booking) {
        setB(res.booking);
        setMileage({ start: res.booking.start_mileage?.toString() ?? "", end: res.booking.end_mileage?.toString() ?? "" });
        setAssignError("");
        onChanged();
      } else setAssignError(res.errors?.vehicle_id ?? res.message ?? "");
    });

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  const km = (n: number | null) => (n === null ? "-" : fmt.number(n));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.bar}`}>
              <CarIcon width={12} height={12} />
              {b.vehicle ? `${b.vehicle.name}${b.vehicle.plate_no ? ` · ${b.vehicle.plate_no}` : ""}` : t("vehicle.unassigned")}
            </span>
            <h3 className="mt-1.5 break-words font-semibold">{b.details}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={`${btn.secondary} ${btn.sm} shrink-0 px-2`}>
            <XIcon width={14} height={14} />
          </button>
        </div>
        <dl className="divide-y divide-line">
          {row(t("vehicle.detail.when"), period)}
          {row(t("meeting.detail.booker"), b.user.name)}
          {row(t("meeting.detail.department"), b.department || "-")}
          {row(t("vehicle.detail.passengers"), t("vehicle.detail.passengersValue", { n: fmt.number(b.passengers) }))}
          {row(t("vehicle.detail.purpose"), b.purpose || "-")}
          {row(t("vehicle.detail.extras"), b.extras.length ? b.extras.join(", ") : "-")}
          {b.note && row(t("vehicle.detail.note"), <span className="whitespace-pre-line">{b.note}</span>)}
          {b.vehicle &&
            row(
              t("vehicle.detail.mileage"),
              b.start_mileage !== null && b.end_mileage !== null
                ? t("vehicle.detail.mileageRange", { start: km(b.start_mileage), end: km(b.end_mileage), distance: km(b.end_mileage - b.start_mileage) })
                : `${km(b.start_mileage)} → ${km(b.end_mileage)}`,
            )}
          {b.assigned_by && row(t("vehicle.detail.assignedBy"), b.assigned_by)}
        </dl>

        {/* ผู้จัดคิวรถ: เลือก / เปลี่ยนรถ */}
        {b.can_assign && vehicles.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-subtle/60 p-3">
            <p className="text-xs font-medium text-muted">{t("vehicle.dispatch.assign")}</p>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <AppSelect value={vehicleId} onValueChange={setVehicleId} className={`${input} ${assignError ? inputError : ""}`}>
                  <option value="">{t("vehicle.form.vehicleNone")}</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={String(v.id)}>
                      {`${v.name}${v.plate_no ? ` · ${v.plate_no}` : ""} · ${t("vehicle.seats", { n: v.seats })}`}
                    </option>
                  ))}
                </AppSelect>
              </div>
              <button type="button" disabled={pending || vehicleId === (b.vehicle ? String(b.vehicle.id) : "")} onClick={assign} className={`${btn.primary} ${btn.sm} shrink-0`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
                {t("vehicle.dispatch.assign")}
              </button>
            </div>
            {assignError && <p className="text-xs font-medium text-red-500">{assignError}</p>}
          </div>
        )}

        {/* บันทึกเลขไมล์ (ระหว่าง / หลังใช้งาน) */}
        {b.can_mileage && (
          <div className="space-y-1.5 rounded-xl bg-subtle/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <GaugeIcon width={14} height={14} />
              {t("vehicle.mileage.title")}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 block text-muted">{t("vehicle.form.startMileage")}</span>
                <input type="number" min={0} inputMode="numeric" value={mileage.start} onChange={(e) => (setMileage({ ...mileage, start: e.target.value }), setMileageError(""))} className={`${input} ${mileageError ? inputError : ""}`} />
              </label>
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 block text-muted">{t("vehicle.form.endMileage")}</span>
                <input type="number" min={0} inputMode="numeric" value={mileage.end} onChange={(e) => (setMileage({ ...mileage, end: e.target.value }), setMileageError(""))} className={`${input} ${mileageError ? inputError : ""}`} />
              </label>
              <button type="button" disabled={pending} onClick={recordMileage} className={`${btn.primary} ${btn.sm} mb-0.5`}>
                {pending ? <SpinnerIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
                {t("common.save")}
              </button>
            </div>
            {mileageError && <p className="text-xs font-medium text-red-500">{mileageError}</p>}
          </div>
        )}

        {(b.can_edit || b.can_cancel || b.can_delete) && (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {b.can_edit && (
              <Link href={`/vehicles/bookings/${b.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                <PencilIcon width={14} height={14} />
                {t("meeting.booking.edit")}
              </Link>
            )}
            {b.can_cancel && (
              <button type="button" disabled={pending} onClick={() => act("cancel")} className={`${btn.secondary} ${btn.sm}`}>
                <XIcon width={14} height={14} />
                {t("meeting.booking.cancel")}
              </button>
            )}
            {b.can_delete && (
              <button type="button" disabled={pending} onClick={() => act("delete")} className={`${btn.danger} ${btn.sm}`}>
                <TrashIcon width={14} height={14} />
                {t("meeting.booking.delete")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
