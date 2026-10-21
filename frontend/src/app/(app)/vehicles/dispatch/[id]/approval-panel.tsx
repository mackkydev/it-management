"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveVehicleBooking, rejectVehicleBooking } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/dialog-provider";
import { AlertIcon, CheckCircleIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { overlaps } from "../../vehicle-utils";

/**
 * ผู้จัดคิวรถ: เลือก/เปลี่ยนรถ (รถที่ติดจองช่วงเดียวกันมีป้าย — API ตรวจซ้ำ) แล้วอนุมัติ หรือไม่อนุมัติพร้อมเหตุผล
 * others = การจองอื่นในช่วงวันเดียวกัน (อนุมัติแล้ว + รออนุมัติ) ใช้บอกรถไม่ว่าง
 */
export function ApprovalPanel({ booking, vehicles, others }: { booking: VehicleBooking; vehicles: Vehicle[]; others: VehicleBooking[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [vehicleId, setVehicleId] = useState(booking.vehicle ? String(booking.vehicle.id) : "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ vehicle_id?: string; reason?: string }>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [, start] = useTransition();

  const taken = (id: number) => others.some((x) => x.vehicle?.id === id && (x.status === "pending" || x.status === "confirmed") && overlaps(x, booking));
  const chosen = vehicles.find((v) => String(v.id) === vehicleId);

  const approve = async () => {
    if (!chosen) return setErrors({ vehicle_id: t("vehicle.approval.vehicle") });
    if (!(await confirm(t("vehicle.approval.confirmApprove", { vehicle: chosen.name }), { danger: false }))) return;
    setBusy("approve");
    start(async () => {
      const res = await approveVehicleBooking(booking.id, chosen.id);
      setBusy(null);
      if (res.ok) return router.push("/vehicles/dispatch?done=approved");
      setErrors({ vehicle_id: res.errors?.vehicle_id });
      setMessage(res.errors?.vehicle_id ? "" : (res.errors?.status ?? res.message ?? ""));
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
