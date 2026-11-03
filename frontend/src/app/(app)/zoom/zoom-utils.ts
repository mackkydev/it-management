import type { TFunction } from "@/i18n/types";
import type { ZoomBooking } from "@/lib/types";

import { IDLE_TONE, toneAt, type Tone } from "@/lib/booking";
import { periodText } from "../vehicles/vehicle-utils";

export { daysOf, periodText, segmentOf, shiftDay, TIME_OPTIONS } from "../vehicles/vehicle-utils";

/** สีแถบตามสถานะ (token สถานะ — เปลี่ยนตามธีม/โหมดมืด): รอรับงาน = เหลือง (เส้นประ), รับงานแล้ว = ฟ้า, ส่งลิงก์แล้ว = เขียว */
export const ZOOM_BAR: Record<ZoomBooking["status"], string> = {
  pending: "bg-warning-100 text-warning-800 ring-warning-300 outline-1 outline-dashed outline-warning-400 dark:bg-warning-400/20 dark:text-warning-200 dark:ring-warning-400/40",
  accepted: "bg-info-100 text-info-800 ring-info-300 dark:bg-info-400/20 dark:text-info-200 dark:ring-info-400/40",
  confirmed: "bg-success-100 text-success-800 ring-success-300 dark:bg-success-400/20 dark:text-success-200 dark:ring-success-400/40",
  needs_change: "bg-danger-100 text-danger-800 ring-danger-300 dark:bg-danger-400/20 dark:text-danger-200 dark:ring-danger-400/40",
  rejected: "bg-idle-100 text-idle-700 ring-idle-300 dark:bg-idle-400/20 dark:text-idle-200 dark:ring-idle-400/40",
  cancelled: "bg-idle-100 text-idle-700 ring-idle-300 dark:bg-idle-400/20 dark:text-idle-200 dark:ring-idle-400/40",
};

/** สีประจำบัญชี ZOOM ตามลำดับในข้อมูล Drop Down — เลี่ยงสีฟ้า/เหลืองของสถานะรับงานแล้ว/รอรับงาน ไว้ท้ายสุด */
const ACCOUNT_TONE_ORDER = [3, 1, 4, 0, 2] as const;
export function accountTone(accounts: string[], account: string): Tone {
  const i = accounts.findIndex((a) => a.toLowerCase() === account.toLowerCase());
  return i < 0 ? IDLE_TONE : toneAt(i, ACCOUNT_TONE_ORDER);
}
/** สีแถบในปฏิทิน / ไทม์ไลน์: มีบัญชี ZOOM แล้ว = สีตามบัญชี, ยังไม่มี = สีตามสถานะ */
export const zoomBarOf = (b: ZoomBooking, accounts: string[]) => (b.zoom_account ? accountTone(accounts, b.zoom_account).bar : ZOOM_BAR[b.status]);

/** จุดสีในคำอธิบาย (legend) */
export const ZOOM_DOT: Record<"pending" | "accepted" | "confirmed", string> = {
  pending: "bg-warning-400",
  accepted: "bg-info-400",
  confirmed: "bg-success-400",
};

/** ป้ายสถานะ (badge) — จบเวลาแล้ว = "ใช้งานแล้ว" */
export function statusKey(z: ZoomBooking): ZoomBooking["status"] | "over" {
  return z.is_over && z.status === "confirmed" ? "over" : z.status;
}

export interface ZoomMeetingInfo {
  topic: string;
  link: string;
  meeting_id: string;
  passcode: string;
}

/**
 * ดึงรายละเอียดจากข้อความเชิญของ ZOOM ที่ฝ่าย IT คัดลอกมาวาง ("Topic: …", "Join Zoom Meeting" + ลิงก์บรรทัดถัดไป, "Meeting ID: …", "Passcode: …")
 * ไม่พบหัวข้อไหน = ค่าว่าง (ลิงก์: ไม่มีหัว Join Zoom Meeting = ลิงก์ zoom.us/j/ แรกในข้อความ)
 */
export function parseZoomInvitation(text: string): ZoomMeetingInfo {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const after = (label: RegExp) => {
    const i = lines.findIndex((l) => label.test(l));
    return i < 0 ? "" : (lines.slice(i + 1).find((l) => /^https?:\/\/\S+$/i.test(l)) ?? "");
  };
  const field = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  return {
    topic: field(/^\s*Topic\s*:\s*(.+)$/im),
    link: after(/^Join Zoom Meeting$/i) || (text.match(/https?:\/\/\S*zoom\.us\/j\/\S+/i)?.[0] ?? ""),
    meeting_id: field(/^\s*Meeting ID\s*:\s*([\d ]+)\s*$/im),
    passcode: field(/^\s*Passcode\s*:\s*(\S+)\s*$/im),
  };
}

/** ข้อความสำหรับคัดลอกส่งต่อ (ผู้จอง / ฝ่าย IT) — Topic จากข้อความเชิญ (ไม่มี = หัวข้อที่จอง), วันเวลา = ช่วงที่จองไว้ */
export function zoomShareText(
  z: Pick<ZoomBooking, "title" | "meeting_topic" | "meeting_link" | "meeting_id" | "passcode" | "start_on" | "start_time" | "end_on" | "end_time">,
  date: (d: string) => string,
  t: TFunction,
): string {
  return [
    `${t("zoom.share.topic")} : ${z.meeting_topic || z.title}`,
    `${t("zoom.share.time")} : ${periodText(z, date)}`,
    "",
    t("zoom.share.join"),
    z.meeting_link ?? "",
    "",
    ...(z.meeting_id ? [`Meeting ID: ${z.meeting_id}`] : []),
    ...(z.passcode ? [`Passcode: ${z.passcode}`] : []),
  ]
    .join("\n")
    .trim();
}
