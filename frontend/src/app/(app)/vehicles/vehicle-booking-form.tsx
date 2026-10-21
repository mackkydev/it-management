"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { loadVehicleBookings, saveVehicleBooking, type VehicleBookingValues } from "@/app/actions/vehicles";
import { AppSelect } from "@/components/app-select";
import { DateInput } from "@/components/date-input";
import { useAlert } from "@/components/dialog-provider";
import { AlertIcon, CarIcon, CheckCircleIcon, CheckIcon, GaugeIcon, MapPinIcon, SaveIcon, SpinnerIcon, UsersIcon } from "@/components/icons";
import { alert, btn, card, input, inputError, tone } from "@/components/ui";
import { IDLE_TONE } from "@/lib/booking";
import { useI18n } from "@/i18n/client";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { endAt, imageUrl, overlaps, periodText, primaryImage, startAt, TIME_OPTIONS, toneOf } from "./vehicle-utils";

type Field = keyof VehicleBookingValues;

/** วันต่างกันกี่วัน */
const daysBetween = (a: string, b: string) => (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;

/**
 * ฟอร์มจอง / แก้ไขการจองรถ — ไม่ระบุรถได้ (ผู้จัดคิวรถเลือกให้), จองหลายวันได้
 * เลือกรถแล้วเลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคันนั้น (แก้ได้), ตรวจรถว่างทันทีที่เลือก (API ตรวจซ้ำตอนบันทึก)
 */
export function VehicleBookingForm({
  id,
  initial,
  initialRange,
  vehicles,
  purposes,
  extras,
  booker,
  lockVehicle = false,
}: {
  id: string | null;
  initial: VehicleBookingValues;
  /** การจองที่คาบเกี่ยวช่วงวันเริ่มต้น (ตรวจรถว่าง) */
  initialRange: VehicleBooking[];
  vehicles: Vehicle[];
  purposes: string[];
  extras: string[];
  booker: { name: string; department: string | null };
  /** อนุมัติแล้ว — ผู้จองเปลี่ยนรถไม่ได้ (API ตรวจซ้ำ) */
  lockVehicle?: boolean;
}) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const showAlert = useAlert();
  const [v, setV] = useState<VehicleBookingValues>(initial);
  const [range, setRange] = useState(initialRange);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [checking, startCheck] = useTransition();
  const [pending, start] = useTransition();
  // เลขไมล์เริ่มต้นที่ระบบเติมให้ (ยังไม่ได้แก้เอง) — เปลี่ยนรถแล้วเติมใหม่ตามคันใหม่
  const [autoMileage, setAutoMileage] = useState(id === null);
  const today = localToday();

  const set = <K extends Field>(k: K, value: VehicleBookingValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const reloadRange = (from: string, to: string) => {
    if (from && to && to >= from && daysBetween(from, to) <= 62) startCheck(async () => setRange(await loadVehicleBookings(from, to)));
  };
  const setDates = (patch: Partial<Pick<VehicleBookingValues, "start_on" | "end_on">>) => {
    const next = { ...v, ...patch };
    if (patch.start_on && (!next.end_on || next.end_on < patch.start_on)) next.end_on = patch.start_on;
    setV(next);
    setErrors((e) => ({
      ...e,
      start_on: undefined,
      end_on: undefined,
      end_time: undefined,
    }));
    reloadRange(next.start_on, next.end_on);
  };

  const vehicle = vehicles.find((o) => String(o.id) === v.vehicle_id) ?? null;
  const timesOk = Boolean(v.start_on && v.end_on && v.start_time && v.end_time && endAt(v) > startAt(v));
  const others = range.filter((b) => b.id !== id && b.vehicle);
  const clashOf = (vehicleId: number) => (timesOk ? others.find((b) => b.vehicle!.id === vehicleId && overlaps(b, v)) : undefined);
  const clash = vehicle ? clashOf(vehicle.id) : undefined;
  const pickVehicle = (x: string) => {
    const veh = vehicles.find((o) => String(o.id) === x);
    // รถที่ถูกจองแล้วในช่วงนี้ — แจ้งเตือน และไม่เปลี่ยนรถที่เลือกไว้
    const busy = veh ? clashOf(veh.id) : undefined;
    if (veh && busy) {
      void showAlert(
        t("vehicle.form.alreadyBooked", {
          vehicle: veh.name,
          period: periodText(busy, fmt.date),
          name: busy.user.name,
        }),
        { title: t("vehicle.form.alreadyBookedTitle"), danger: true },
      );
      return;
    }
    setV((p) => ({
      ...p,
      vehicle_id: x,
      ...(autoMileage || !p.start_mileage ? { start_mileage: veh?.mileage != null ? String(veh.mileage) : "" } : {}),
    }));
    if (!v.start_mileage) setAutoMileage(true);
    setErrors((e) => ({ ...e, vehicle_id: undefined }));
  };
  const vehicleRange = vehicle ? others.filter((b) => b.vehicle!.id === vehicle.id) : [];
  const overSeats = vehicle && Number(v.passengers) > vehicle.seats;
  // ยังไม่ได้เลือกวันเวลาเริ่มต้น-สิ้นสุด (หรือกำลังโหลดการจองของช่วงนั้น) = ยังเลือกรถไม่ได้ — ต้องรู้ช่วงเวลาก่อนจึงตรวจรถว่างได้
  const vehicleLocked = !timesOk || checking || lockVehicle;
  const timeOptions = [...new Set([...TIME_OPTIONS, initial.start_time, initial.end_time].filter(Boolean))].sort();

  const submit = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.details.trim()) e.details = t("vehicle.form.validate.details");
    if (!(Number(v.passengers) >= 1)) e.passengers = t("vehicle.form.validate.passengers");
    if (!v.start_on || !v.end_on || !v.start_time || !v.end_time) e.end_on = t("vehicle.form.validate.dates");
    else if (!timesOk) e.end_time = t("vehicle.form.validate.order");
    if (!v.purpose) e.purpose = t("vehicle.form.validate.purpose");
    if (clash) e.vehicle_id = t("vehicle.form.validate.conflict");
    if (v.start_mileage && v.end_mileage && Number(v.end_mileage) < Number(v.start_mileage)) e.end_mileage = t("vehicle.form.validate.mileage");
    setErrors(e);
    setMessage("");
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await saveVehicleBooking(id, v);
      // รออนุมัติ (จองใหม่ / แก้เวลา-รถของที่อนุมัติแล้ว) = แจ้งว่าส่งคำขอแล้ว
      if (res.ok) return router.push(`/vehicles/day/${v.start_on}?done=${res.status === "pending" ? "requested" : id ? "updated" : "created"}`);
      setErrors(res.errors ?? {});
      setMessage(res.message ?? "");
      reloadRange(v.start_on, v.end_on);
    });
  };

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {text} {required && <span className="text-red-500">*</span>}
    </label>
  );
  const err = (k: Field) => (errors[k] ? <p className="mt-1 text-xs font-medium text-red-500">{errors[k]}</p> : null);
  const cls = (k: Field) => `${input} ${errors[k] ? inputError : ""}`;
  const timeSelect = (k: "start_time" | "end_time") => (
    <AppSelect id={k} value={v[k]} onValueChange={(x) => set(k, x)} className={cls(k)} options={timeOptions.map((o) => ({ value: o, label: o }))} />
  );

  return (
    <form action={submit} className="space-y-5">
      {message && (
        <p role="alert" className={alert.error}>
          <AlertIcon className="shrink-0 text-danger-400" />
          {message}
        </p>
      )}
      <fieldset disabled={pending} className="grid grid-cols-1 gap-5 disabled:opacity-60 lg:grid-cols-[1fr_20rem]">
        <div className={`space-y-4 p-5 ${card}`}>
          {/* วันเวลา */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              {label("start_on", t("vehicle.form.startOn"), true)}
              <DateInput id="start_on" value={v.start_on} min={id ? undefined : today} onChange={(d) => setDates({ start_on: d })} className={cls("start_on")} />
              {err("start_on")}
            </div>
            <div>
              {label("start_time", t("vehicle.form.startTime"), true)}
              {timeSelect("start_time")}
            </div>
            <div>
              {label("end_on", t("vehicle.form.endOn"), true)}
              <DateInput id="end_on" value={v.end_on} min={v.start_on || undefined} onChange={(d) => setDates({ end_on: d })} className={cls("end_on")} />
              {err("end_on")}
            </div>
            <div>
              {label("end_time", t("vehicle.form.endTime"), true)}
              {timeSelect("end_time")}
              {err("end_time")}
            </div>
          </div>

          {/* รถ */}
          <div>
            {label("vehicle_id", t("vehicle.form.vehicle"))}
            {/* จอคอมพิวเตอร์: การ์ดรถ (สีตามรถ + สถานะในช่วงเวลาที่เลือก) — จอเล็กใช้ dropdown ด้านล่าง */}
            <div role="radiogroup" aria-labelledby="vehicle_id" className="hidden grid-cols-6 gap-1.5 md:grid">
              {[null, ...vehicles].map((o) => {
                const value = o ? String(o.id) : "";
                const on = v.vehicle_id === value;
                const busy = o ? clashOf(o.id) : undefined;
                return (
                  <button
                    key={value || "none"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={vehicleLocked}
                    onClick={() => pickVehicle(value)}
                    className={`relative flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50 ${o ? toneOf(vehicles, o.id).bar : IDLE_TONE.bar} ${
                      on ? "outline-2 outline-offset-2 outline-accent-500" : "hover:brightness-95 dark:hover:brightness-110"
                    }`}
                  >
                    {on && <CheckIcon width={12} height={12} className="absolute right-1.5 top-1.5" />}
                    <CarIcon width={16} height={16} />
                    <span className="line-clamp-2 w-full break-words pr-3 text-xs font-semibold leading-4">{o ? o.name : t("vehicle.form.noneShort")}</span>
                    <span className="w-full truncate text-[11px] leading-4 opacity-80">{o ? [o.plate_no, o.vehicle_type].filter(Boolean).join(" · ") || "-" : t("vehicle.form.noneHint")}</span>
                    {o && timesOk && (
                      <span className={`inline-flex rounded-full px-1.5 text-[10px] font-medium leading-4 ${busy ? tone.danger.badge : tone.success.badge}`}>
                        {busy ? t("vehicle.form.statusBusy") : t("vehicle.form.statusReady")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="md:hidden">
              <AppSelect
                id="vehicle_id"
                value={v.vehicle_id}
                onValueChange={pickVehicle}
                disabled={vehicleLocked}
                className={`${cls("vehicle_id")} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <option value="">{t("vehicle.form.vehicleNone")}</option>
                {vehicles.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {`${o.name}${o.plate_no ? ` · ${o.plate_no}` : ""} · ${t("vehicle.seats", { n: o.seats })}${clashOf(o.id) ? ` — ${t("vehicle.form.vehicleBusy")}` : ""}`}
                  </option>
                ))}
              </AppSelect>
            </div>
            {err("vehicle_id")}
            {lockVehicle ? (
              <p className="mt-1 text-xs text-muted">{t("vehicle.form.vehicleLockedHint")}</p>
            ) : (
              !timesOk && <p className="mt-1 text-xs text-muted">{t("vehicle.form.vehicleNeedsTime")}</p>
            )}
          </div>

          {/* รถว่างไหมในช่วงที่เลือก */}
          {vehicle && (
            <div className="space-y-2 rounded-xl bg-subtle/60 p-3 text-xs">
              <p className="flex items-center gap-2 font-medium text-muted">
                {t("vehicle.form.rangeBookings")}
                {checking && <SpinnerIcon width={12} height={12} className="text-accent-400" />}
              </p>
              {vehicleRange.length > 0 && (
                <ul className="space-y-1">
                  {vehicleRange.map((b) => (
                    <li
                      key={b.id}
                      className={`rounded-lg px-2 py-1 ring-1 ring-inset ${overlaps(b, v) && timesOk ? "bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-400/10 dark:text-danger-300 dark:ring-danger-400/30" : "bg-surface ring-line"}`}
                    >
                      {periodText(b, fmt.date)} · {b.details} ({b.user.name})
                    </li>
                  ))}
                </ul>
              )}
              {checking ? (
                <p className="text-muted">{t("vehicle.form.checking")}</p>
              ) : clash ? (
                <p role="alert" className={alert.warning}>
                  <AlertIcon className="shrink-0" />
                  {t("vehicle.form.conflict", {
                    vehicle: vehicle.name,
                    period: periodText(clash, fmt.date),
                    name: clash.user.name,
                  })}
                </p>
              ) : timesOk ? (
                <p className="flex items-center gap-1.5 font-medium text-success-700 dark:text-success-300">
                  <CheckCircleIcon width={14} height={14} />
                  {vehicleRange.length ? t("vehicle.form.available") : t("vehicle.form.rangeFree")}
                </p>
              ) : null}
            </div>
          )}

          {/* รายละเอียด */}
          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {label("details", t("vehicle.form.details"), true)}
              <textarea
                id="details"
                rows={3}
                maxLength={2000}
                value={v.details}
                onChange={(e) => set("details", e.target.value)}
                placeholder={t("vehicle.form.detailsPlaceholder")}
                className={cls("details")}
              />
              {err("details")}
            </div>
            <div>
              {label("passengers", t("vehicle.form.passengers"), true)}
              <input
                id="passengers"
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={v.passengers}
                onChange={(e) => set("passengers", e.target.value)}
                className={cls("passengers")}
              />
              {err("passengers")}
              {overSeats && (
                <p className="mt-1 text-xs font-medium text-warning-700 dark:text-warning-300">
                  {t("vehicle.form.overSeats", {
                    n: v.passengers,
                    seats: vehicle!.seats,
                  })}
                </p>
              )}
            </div>
            <div>
              {label("purpose", t("vehicle.form.purpose"), true)}
              <AppSelect id="purpose" value={v.purpose} onValueChange={(x) => set("purpose", x)} className={cls("purpose")}>
                <option value="">{t("vehicle.form.purposePlaceholder")}</option>
                {[...new Set([...purposes, ...(initial.purpose ? [initial.purpose] : [])])].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </AppSelect>
              {err("purpose")}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">{t("vehicle.form.booker")}</span>
              <p className={`${input} bg-subtle text-muted`}>{booker.name}</p>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">{t("vehicle.form.department")}</span>
              <p className={`${input} bg-subtle text-muted`}>{booker.department || "-"}</p>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 block text-sm font-medium">{t("vehicle.form.extras")}</legend>
              {extras.length === 0 && initial.extras.length === 0 ? (
                <p className="text-xs text-muted">{t("vehicle.form.noExtras")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...extras, ...initial.extras])].map((x) => {
                    const on = v.extras.includes(x);
                    return (
                      <label
                        key={x}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm ring-1 transition-colors ${on ? "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/15 dark:text-accent-200 dark:ring-accent-400/40" : "ring-line hover:bg-subtle"}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set("extras", on ? v.extras.filter((y) => y !== x) : [...v.extras, x])}
                          className="h-4 w-4 cursor-pointer accent-[var(--accent-500)]"
                        />
                        {x}
                      </label>
                    );
                  })}
                </div>
              )}
              {err("extras")}
            </fieldset>
            <div className="sm:col-span-2">
              {label("note", t("vehicle.form.note"))}
              <textarea id="note" rows={2} maxLength={2000} value={v.note} onChange={(e) => set("note", e.target.value)} className={cls("note")} />
            </div>
          </div>

          {/* เลขไมล์ (เมื่อเลือกรถ) */}
          {vehicle && (
            <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <div>
                {label("start_mileage", t("vehicle.form.startMileage"))}
                <input
                  id="start_mileage"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  // อ่านอย่างเดียว — ดึงจากเลขไมล์ล่าสุดของรถ (เลขไมล์สิ้นสุดที่บันทึกตอนคืนรถครั้งก่อน)
                  value={vehicle.mileage != null ? String(vehicle.mileage) : v.start_mileage}
                  readOnly
                  disabled
                  className={`${cls("start_mileage")} disabled:cursor-not-allowed disabled:opacity-60`}
                />
                {err("start_mileage")}
                {vehicle.mileage !== null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                    <GaugeIcon width={12} height={12} />
                    {t("vehicle.form.mileageLatest", {
                      n: fmt.number(vehicle.mileage),
                    })}
                  </p>
                )}
              </div>
              <div>
                {label("end_mileage", t("vehicle.form.endMileage"))}
                <input
                  id="end_mileage"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={v.end_mileage}
                  onChange={(e) => set("end_mileage", e.target.value)}
                  // เลขไมล์สิ้นสุดบันทึกหลังใช้งานที่ "การจองรถของฉัน" (บันทึกได้ครั้งเดียว)
                  disabled
                  className={`${cls("end_mileage")} disabled:cursor-not-allowed disabled:opacity-60`}
                />
                {err("end_mileage")}
                <p className="mt-1 text-xs text-muted">{t("vehicle.form.mileageHint")}</p>
              </div>
            </div>
          )}
        </div>

        {/* ข้อมูลรถที่เลือก */}
        <aside className={`h-fit overflow-hidden ${card}`}>
          {vehicle ? (
            <>
              {primaryImage(vehicle) ? (
                // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
                <img src={imageUrl(vehicle.id, primaryImage(vehicle)!.id)} alt={vehicle.name} className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-subtle text-faint">
                  <CarIcon width={40} height={40} />
                </div>
              )}
              <div className="space-y-1.5 p-4 text-sm">
                <p className="font-semibold">
                  {vehicle.name}
                  {vehicle.plate_no && <span className="ml-1.5 font-normal text-muted">{vehicle.plate_no}</span>}
                </p>
                <p className="flex items-center gap-1.5 text-muted">
                  <UsersIcon width={14} height={14} className="shrink-0" />
                  {t("vehicle.seats", { n: vehicle.seats })}
                </p>
                {vehicle.parking && (
                  <p className="flex items-center gap-1.5 text-muted">
                    <MapPinIcon width={14} height={14} className="shrink-0" />
                    {vehicle.parking}
                  </p>
                )}
                {vehicle.mileage !== null && (
                  <p className="flex items-center gap-1.5 text-muted">
                    <GaugeIcon width={14} height={14} className="shrink-0" />
                    {t("vehicle.mileageValue", {
                      n: fmt.number(vehicle.mileage),
                    })}
                  </p>
                )}
                {vehicle.description && <p className="whitespace-pre-line pt-1 text-xs text-muted">{vehicle.description}</p>}
              </div>
            </>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-subtle p-4 text-center text-sm text-faint">
              <CarIcon width={36} height={36} />
              {t("vehicle.form.vehicleNone")}
            </div>
          )}
        </aside>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.back()} disabled={pending} className={btn.secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? <SpinnerIcon /> : <SaveIcon />}
          {t("vehicle.form.save")}
        </button>
      </div>
    </form>
  );
}
