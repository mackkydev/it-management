"use server";

import { getCurrentUser } from "@/lib/auth";

/** เวลาล้าง clipboard หลังคัดลอกข้อมูลลับ (วินาที) — ตั้งที่หน้าตั้งค่า ความปลอดภัยตอนเปิดดูรหัสผ่าน / License key */
export async function clipboardClearSeconds(): Promise<number> {
  return (await getCurrentUser()).clipboard_clear_seconds ?? 30;
}
