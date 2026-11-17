"use client";

import { useEffect, useState } from "react";
import { loadDaysOff } from "@/app/actions/calendar";

/** วันหยุดบริษัทของช่วงวัน (date → ชื่อวันหยุด) — โหลดใหม่เมื่อเปลี่ยนช่วง (เปลี่ยนเดือน) */
export function useDaysOff(from: string, to: string): Map<string, string> {
  const [state, setState] = useState<{ key: string; map: Map<string, string> }>({ key: "", map: new Map() });
  const key = `${from}|${to}`;
  useEffect(() => {
    let alive = true;
    loadDaysOff(from, to).then(
      (rows) => {
        if (alive) setState({ key, map: new Map(rows.map((r) => [r.date, r.name])) });
      },
      () => undefined, // เชื่อมต่อไม่ได้ = ไม่ระบายวันหยุด (เสาร์-อาทิตย์ยังระบาย)
    );
    return () => {
      alive = false;
    };
  }, [from, to, key]);
  return state.key === key ? state.map : EMPTY;
}
const EMPTY = new Map<string, string>();

/** เสาร์-อาทิตย์ ("YYYY-MM-DD") */
export const isWeekend = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

/** พื้นวันเสาร์ (ฟ้าอ่อน `.cal-sat`) / วันอาทิตย์ (แดงอ่อน `.cal-sun`) / วันอื่น = ไม่มี — globals.css */
export function weekendClass(d: string): string {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 6 ? "cal-sat" : w === 0 ? "cal-sun" : "";
}

/** พื้นช่องวันในปฏิทิน: วันหยุดบริษัท (`.cal-holiday`) ก่อน แล้วเสาร์ / อาทิตย์ (weekendClass) / วันทำงาน = ไม่มี */
export function dayOffClass(d: string, daysOff: Map<string, string>): string {
  if (daysOff.has(d)) return "cal-holiday";
  return weekendClass(d);
}
