"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { CarIcon, GaugeIcon, UsersIcon } from "@/components/icons";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { IDLE_TONE } from "@/lib/booking";
import { localToday } from "@/lib/date";
import type { Vehicle, VehicleBooking } from "@/lib/types";
import { VehicleDialog } from "../../vehicle-dialog";
import { imageUrl, primaryImage, segmentOf, toneOf } from "../../vehicle-utils";

const noopSubscribe = () => () => {};
const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const SPAN = 24 * 60;
const HOURS = Array.from({ length: 13 }, (_, i) => i * 2); // ป้ายทุก 2 ชม. 00–24
const pct = (min: number) => (min / SPAN) * 100;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * ไทม์ไลน์การจองรถของวัน (00:00–24:00) — แถวละ 1 คัน + แถว "รอจัดรถ" (การจองที่ยังไม่ระบุรถ)
 * การจองหลายวันแสดงเฉพาะส่วนของวันนั้น, คลิกช่องว่าง = จองคันนั้นตั้งแต่เวลานั้น (ปัดลงชั่วโมง), คลิกแถบ = รายละเอียด
 */
export function VehicleTimeline({ date, vehicles, bookings, canDispatch, bookable = true }: { date: string; vehicles: Vehicle[]; bookings: VehicleBooking[]; canDispatch: boolean; bookable?: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<VehicleBooking | null>(null);
  const [hover, setHover] = useState<{ row: number; min: number } | null>(null);
  const today = localToday();
  // วันที่ผ่านไปแล้ว / ซ่อนปุ่มจองไว้ (หน้าสิทธิ์การใช้งาน) = คลิกช่องว่างจองไม่ได้
  const past = date < today || !bookable;
  const nowMin = useSyncExternalStore(noopSubscribe, minutesNow, () => -1);
  const unassigned = bookings.filter((b) => !b.vehicle);
  const rows: { id: number; vehicle: Vehicle | null; list: VehicleBooking[] }[] = [
    ...vehicles.map((v) => ({ id: v.id, vehicle: v, list: bookings.filter((b) => b.vehicle?.id === v.id) })),
    ...(unassigned.length ? [{ id: 0, vehicle: null, list: unassigned }] : []),
  ];

  const slotAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(23 * 60, Math.max(0, Math.floor((((e.clientX - r.left) / r.width) * SPAN) / 60) * 60));
  };
  const busy = (list: VehicleBooking[], min: number) => list.some((b) => {
    const [s, e] = segmentOf(b, date);
    return s < min + 60 && e > min;
  });
  const canBook = (min: number) => !past && !(date === today && min + 60 <= nowMin);
  const book = (vehicleId: number, min: number) =>
    router.push(`/vehicles/book?${new URLSearchParams({ date, vehicle: String(vehicleId), start: hm(min), end: hm(Math.min(min + 2 * 60, 23 * 60 + 30)) })}`);
  const tone = (b: VehicleBooking) => (b.vehicle ? toneOf(vehicles, b.vehicle.id) : IDLE_TONE);

  const head = (v: Vehicle | null) => {
    if (!v)
      return (
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-subtle text-faint ring-1 ring-line">
            <CarIcon width={18} height={18} />
          </span>
          <p className="text-sm font-medium text-muted">{t("vehicle.unassignedRow")}</p>
        </div>
      );
    const img = primaryImage(v);
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- รูปส่วนตัวผ่าน /files (ต้องมี cookie) ใช้ next/image ไม่ได้
          <img src={imageUrl(v.id, img.id)} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover ring-1 ring-line" />
        ) : (
          <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-subtle text-faint ring-1 ring-line">
            <CarIcon width={18} height={18} />
          </span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className={`h-2 w-2 shrink-0 rounded-full ${toneOf(vehicles, v.id).dot}`} aria-hidden="true" />
            <span className="truncate">{v.name}</span>
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-muted">
            <UsersIcon width={12} height={12} className="shrink-0" />
            {t("vehicle.seats", { n: v.seats })}
            {v.plate_no && ` · ${v.plate_no}`}
          </p>
          {v.mileage !== null && (
            <p className="flex items-center gap-1 text-[11px] text-faint">
              <GaugeIcon width={11} height={11} />
              {t("vehicle.mileageValue", { n: fmt.number(v.mileage) })}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={`hidden overflow-hidden md:block ${card}`}>
        <div className="grid grid-cols-[14rem_1fr] border-b border-line bg-subtle text-xs text-muted">
          <div className="px-3 py-2 font-medium">{t("vehicle.vehiclesTotal", { n: vehicles.length })}</div>
          <div className="relative mr-3 h-8">
            {HOURS.map((h) => (
              <span key={h} className="absolute top-2 -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full" style={{ left: `${pct(h * 60)}%` }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[14rem_1fr] border-b border-line last:border-b-0">
            <div className="border-r border-line px-3 py-2.5">{head(r.vehicle)}</div>
            <div
              className={`relative mr-3 h-16 ${past || !r.vehicle ? "" : "cursor-pointer"}`}
              onMouseMove={(e) => r.vehicle && setHover({ row: r.id, min: slotAt(e) })}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                const min = slotAt(e);
                if (r.vehicle && canBook(min) && !busy(r.list, min)) book(r.vehicle.id, min);
              }}
            >
              {HOURS.slice(1, -1).map((h) => (
                <span key={h} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${pct(h * 60)}%` }} aria-hidden="true" />
              ))}
              {hover?.row === r.id && canBook(hover.min) && !busy(r.list, hover.min) && (
                <span
                  className="pointer-events-none absolute inset-y-2 flex items-center justify-center rounded-md border border-dashed border-accent-300 bg-accent-50 text-[11px] font-medium text-accent-700 dark:border-accent-400/50 dark:bg-accent-400/10 dark:text-accent-200"
                  style={{ left: `${pct(hover.min)}%`, width: `${pct(60)}%` }}
                >
                  +
                </span>
              )}
              {r.list.map((b, i) => {
                const [s, e] = segmentOf(b, date);
                // แถวรอจัดรถอาจซ้อนกัน — แบ่งครึ่งความสูงสลับกัน
                const stack = !r.vehicle && r.list.length > 1 ? (i % 2 === 0 ? "top-1 h-[calc(50%-4px)]" : "bottom-1 h-[calc(50%-4px)]") : "inset-y-2";
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={(ev) => (ev.stopPropagation(), setSelected(b))}
                    onMouseMove={(ev) => ev.stopPropagation()}
                    className={`absolute z-10 cursor-pointer overflow-hidden rounded-md px-2 text-left ring-1 ring-inset ${stack} ${tone(b).bar}`}
                    style={{ left: `${pct(s)}%`, width: `${pct(e - s)}%` }}
                  >
                    <span className="block truncate text-xs font-semibold leading-5">{b.details}</span>
                    <span className="block truncate text-[11px] leading-4 opacity-80">
                      {b.start_on === date ? b.start_time : "…"}–{b.end_on === date ? b.end_time : "…"} · {b.user.name}
                    </span>
                  </button>
                );
              })}
              {date === today && nowMin >= 0 && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-danger-400" style={{ left: `${pct(nowMin)}%` }} aria-hidden="true" />}
            </div>
          </div>
        ))}
      </div>

      {/* จอเล็ก: การ์ดต่อคัน */}
      <div className="space-y-3 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className={`space-y-2 p-3 ${card}`}>
            {head(r.vehicle)}
            {r.list.length === 0 ? (
              <p className="text-xs text-muted">{t("meeting.free")}</p>
            ) : (
              r.list.map((b) => (
                <button key={b.id} type="button" onClick={() => setSelected(b)} className={`block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left ring-1 ring-inset ${tone(b).bar}`}>
                  <span className="block text-xs font-semibold">
                    {b.start_on === date ? b.start_time : "…"}–{b.end_on === date ? b.end_time : "…"} · {b.details}
                  </span>
                  <span className="block text-[11px] opacity-80">{b.user.name}</span>
                </button>
              ))
            )}
            {!past && r.vehicle && (
              <Link href={`/vehicles/book?${new URLSearchParams({ date, vehicle: String(r.vehicle.id) })}`} className="inline-flex cursor-pointer text-xs font-medium text-accent-600 dark:text-accent-300">
                + {t("vehicle.book")}
              </Link>
            )}
          </div>
        ))}
      </div>

      {selected && <VehicleDialog booking={selected} tone={tone(selected)} vehicles={canDispatch ? vehicles : []} onClose={() => setSelected(null)} onChanged={() => router.refresh()} />}
    </>
  );
}
