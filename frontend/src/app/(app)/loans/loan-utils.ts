import type { Loan } from "@/lib/types";

/** ส่วนกลางของหน้ายืมอุปกรณ์ IT — ช่วงเวลา / ตัวเลือกเวลา ใช้ชุดเดียวกับระบบจองรถ (หลายวันได้) */
export { daysOf, endAt, overlaps, periodText, startAt, TIME_OPTIONS } from "../vehicles/vehicle-utils";

/** สถานะที่แสดง: on_loan ที่เลยกำหนดคืน = overdue */
export type LoanState = "reserved" | "on_loan" | "overdue" | "returned" | "cancelled";
export const stateOf = (l: Pick<Loan, "status" | "is_overdue">): LoanState => (l.is_overdue ? "overdue" : l.status);

/** สีตามสถานะ (token สถานะ — เปลี่ยนตามธีม/โหมดมืด) */
export const STATE_TONE: Record<LoanState, { bar: string; dot: string }> = {
  reserved: { bar: "bg-info-100 text-info-800 ring-info-300 dark:bg-info-400/20 dark:text-info-200 dark:ring-info-400/40", dot: "bg-info-400" },
  on_loan: { bar: "bg-accent-100 text-accent-800 ring-accent-300 dark:bg-accent-400/20 dark:text-accent-200 dark:ring-accent-400/40", dot: "bg-accent-400" },
  overdue: { bar: "bg-danger-100 text-danger-800 ring-danger-300 dark:bg-danger-400/20 dark:text-danger-200 dark:ring-danger-400/40", dot: "bg-danger-400" },
  returned: { bar: "bg-idle-100 text-idle-700 ring-idle-300 dark:bg-idle-400/20 dark:text-idle-200 dark:ring-idle-400/40", dot: "bg-idle-400" },
  cancelled: { bar: "bg-idle-100 text-idle-700 ring-idle-300 dark:bg-idle-400/20 dark:text-idle-200 dark:ring-idle-400/40", dot: "bg-idle-400" },
};

export const deviceLabel = (a: { asset_tag: string; name: string }) => `${a.asset_tag} · ${a.name}`;

/** จำนวนสีแยกโน้ตบุ๊ก (.loan-dev-0 … .loan-dev-7 ใน globals.css) */
const DEVICE_COLORS = 8;

/** สีประจำโน้ตบุ๊ก (เรียงตาม id ให้คงที่) — ใช้ทั้งรายการโน้ตบุ๊กและแถบในปฏิทิน; ไม่อยู่ในรายการแล้ว = สีกลาง */
export function loanColorOf(deviceIds: number[]): (id: number) => string {
  const order = new Map([...deviceIds].sort((a, b) => a - b).map((id, i) => [id, `loan-dev-${i % DEVICE_COLORS}`]));
  return (id) => order.get(id) ?? "bg-subtle text-muted ring-line";
}
