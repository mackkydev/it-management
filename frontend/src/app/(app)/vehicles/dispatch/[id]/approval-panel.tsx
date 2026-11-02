"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveVehicleBooking, cancelVehicleBooking, rejectVehicleBooking } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vehicle, VehicleBooking, VehicleDriver } from "@/lib/types";
import { overlaps } from "../../vehicle-utils";

/**
 * ผู้จัดคิวรถ: เลือก/เปลี่ยนรถ (รถที่ติดจองช่วงเดียวกันมีป้าย — API ตรวจซ้ำ) แล้วอนุมัติ หรือไม่อนุมัติพร้อมเหตุผล
 * others = การจองอื่นในช่วงวันเดียวกัน (อนุมัติแล้ว + รออนุมัติ) ใช้บอกรถไม่ว่าง
 * drivers = คนขับที่เลือกให้การจองนี้ได้ (busy = ติดงานช่วงเดียวกัน — เลือกไม่ได้) — ผู้จองไม่ขอคนขับ = แสดง "ไม่เอาคนขับ"
 */
export function ApprovalPanel({ booking, vehicles, others, drivers }: { booking: VehicleBooking; vehicles: Vehicle[]; others: VehicleBooking[]; drivers: VehicleDriver[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [vehicleId, setVehicleId] = useState(booking.vehicle ? String(booking.vehicle.id) : "");
  const [driverId, setDriverId] = useState(booking.driver ? String(booking.driver.id) : "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ vehicle_id?: string; driver_id?: string; reason?: string }>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [, start] = useTransition();

  const taken = (id: number) => others.some((x) => x.vehicle?.id === id && (x.status === "pending" || x.status === "confirmed") && overlaps(x, booking));
  const chosen = vehicles.find((v) => String(v.id) === vehicleId);

  const approve = async () => {
    if (!chosen) return setErrors({ vehicle_id: t("vehicle.approval.vehicle") });
    const driver = booking.needs_driver ? Number(driverId) || null : null;
    if (booking.needs_driver && !driver) return setErrors({ driver_id: t("vehicle.approval.driverRequired") });
    if (!(await confirm(t("vehicle.approval.confirmApprove", { vehicle: chosen.name }), { danger: false }))) return;
    setBusy("approve");
    start(async () => {
      let res = await approveVehicleBooking(booking.id, chosen.id, false, driver);
      // รถที่เลือกติดการจองอื่น → ถามแล้วสลับรถกับรายการนั้น
      if (res.swap && (await confirm(`${res.message}\n\n${t("swap.confirm")}`, { danger: false }))) res = await approveVehicleBooking(booking.id, chosen.id, true, driver);
      setBusy(null);
      if (res.ok) return router.push("/vehicles/dispatch?done=approved");
      if (res.swap) return;
      setErrors({ vehicle_id: res.errors?.vehicle_id, driver_id: res.errors?.driver_id });
      setMessage(res.errors?.vehicle_id || res.errors?.driver_id ? "" : (res.errors?.status ?? res.message ?? ""));
    });
  };
  const reject = async () => {
    if (!reason.trim()) return setErrors({ reason: t("vehicle.approval.reasonRequired") });
    if (!(await confirm(t("vehicle.approval.confirmReject")))) return;
    setBusy("reject");
    start(async () => {
      const res = await rejectVehicleBooking(booking.id, reason);
      setBusy(null);
      if (res.ok) return router.push("/vehicles/dispatch?done=rejected");
      setErrors({ reason: res.errors?.reason });
      setMessage(res.errors?.reason ? "" : (res.errors?.status ?? res.message ?? ""));
    });
  };

  return (
    <section className={`space-y-4 p-4 sm:p-5 ${card}`}>
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("vehicle.booking.statuses.pending")}</span>
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0" />
          {message}
        </p>
      )}
      <div>
        <label htmlFor="approval-vehicle" className="mb-1 block text-sm font-medium">
          {t("vehicle.approval.vehicle")}
        </label>
        <AppSelect
          id="approval-vehicle"
          value={vehicleId}
          onValueChange={(v) => (setVehicleId(v), setErrors((e) => ({ ...e, vehicle_id: undefined })))}
          className={`${input} ${errors.vehicle_id ? inputError : ""}`}
        >
          <option value="">{t("vehicle.form.vehicleNone")}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={String(v.id)}>
              {`${v.name}${v.plate_no ? ` · ${v.plate_no}` : ""} · ${t("vehicle.seats", { n: v.seats })}${taken(v.id) ? ` — ${t("vehicle.form.vehicleBusy")}` : ""}`}
            </option>
          ))}
        </AppSelect>
        {errors.vehicle_id ? <p className="mt-1 text-xs text-red-500">{errors.vehicle_id}</p> : <p className="mt-1 text-xs text-muted">{t("vehicle.approval.vehicleHint")}</p>}
      </div>
      <DriverPicker booking={booking} drivers={drivers} value={driverId} error={errors.driver_id} onChange={(v) => (setDriverId(v), setErrors((e) => ({ ...e, driver_id: undefined })))} />
      <button type="button" onClick={approve} disabled={busy !== null} className={`${btn.primary} w-full justify-center disabled:cursor-not-allowed disabled:opacity-60`}>
        {busy === "approve" ? <SpinnerIcon width={16} height={16} /> : <CheckCircleIcon width={16} height={16} />}
        {t("vehicle.approval.approve")}
      </button>

      <div className="space-y-2 border-t border-line pt-4">
        <label htmlFor="approval-reason" className="block text-sm font-medium">
          {t("vehicle.approval.reason")}
        </label>
        <textarea
          id="approval-reason"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => (setReason(e.target.value), setErrors((x) => ({ ...x, reason: undefined })))}
          className={`${input} ${errors.reason ? inputError : ""}`}
        />
        {errors.reason && <p className="text-xs text-red-500">{errors.reason}</p>}
        <button type="button" onClick={reject} disabled={busy !== null} className={`${btn.danger} w-full justify-center disabled:cursor-not-allowed disabled:opacity-60`}>
          {busy === "reject" ? <SpinnerIcon width={16} height={16} /> : <XIcon width={16} height={16} />}
          {t("vehicle.approval.reject")}
        </button>
      </div>
    </section>
  );
}

const driverLabel = (d: { name: string; nickname: string | null }) => (d.nickname ? `${d.name} (${d.nickname})` : d.name);

/** คนขับ: ผู้จองขอคนขับ = เลือกจากรายชื่อ (ติดงานช่วงเดียวกัน = สีเทา เลือกไม่ได้ ต่อท้าย "(ติดงาน)") / ไม่ขอ = "ไม่เอาคนขับ" */
function DriverPicker({ booking, drivers, value, error, onChange }: { booking: VehicleBooking; drivers: VehicleDriver[]; value: string; error?: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <label htmlFor="approval-driver" className="mb-1 block text-sm font-medium">
        {t("vehicle.approval.driver")} {booking.needs_driver && <span className="text-red-500">*</span>}
      </label>
      {booking.needs_driver ? (
        <>
          <AppSelect id="approval-driver" value={value} onValueChange={onChange} className={`${input} ${error ? inputError : ""}`}>
            <option value="">{t("vehicle.approval.driverChoose")}</option>
            {drivers.map((d) => (
              <option key={d.id} value={String(d.id)} disabled={d.busy}>
                {`${driverLabel(d)}${d.busy ? ` ${t("vehicle.approval.driverBusy")}` : ""}`}
              </option>
            ))}
          </AppSelect>
          {error ? (
            <p className="mt-1 text-xs text-red-500">{error}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">{drivers.length ? t("vehicle.approval.driverHint") : t("vehicle.approval.noDrivers")}</p>
          )}
        </>
      ) : (
        <p className="rounded-xl bg-subtle px-3 py-2 text-sm text-muted">{t("vehicle.approval.noDriver")}</p>
      )}
    </div>
  );
}

/** ผู้จัดคิวยกเลิกการจองที่อนุมัติแล้ว — ต้องระบุเหตุผล (แจ้งผู้จองพร้อมเหตุผล) */
export function DispatchCancelPanel({ booking }: { booking: VehicleBooking }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const cancel = async () => {
    if (!reason.trim()) return setError(t("vehicle.approval.cancelReasonRequired"));
    if (!(await confirm(t("vehicle.approval.confirmCancel")))) return;
    setBusy(true);
    start(async () => {
      const res = await cancelVehicleBooking(booking.id, reason);
      setBusy(false);
      if (res.ok) return router.push("/vehicles/dispatch?done=cancelled");
      setError(res.errors?.reason ?? res.errors?.status ?? res.message ?? t("common.saveFailed"));
    });
  };
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <label htmlFor="dispatch-cancel-reason" className="block text-sm font-medium">
        {t("vehicle.approval.cancelReason")} <span className="text-red-500">*</span>
      </label>
      <textarea
        id="dispatch-cancel-reason"
        rows={3}
        maxLength={1000}
        value={reason}
        onChange={(e) => (setReason(e.target.value), setError(""))}
        className={`${input} ${error ? inputError : ""}`}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button type="button" onClick={cancel} disabled={busy} className={`${btn.danger} w-full justify-center disabled:cursor-not-allowed disabled:opacity-60`}>
        {busy ? <SpinnerIcon width={16} height={16} /> : <XIcon width={16} height={16} />}
        {t("vehicle.approval.cancelBooking")}
      </button>
    </div>
  );
}
