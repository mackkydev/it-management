"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { BookingKind, BookingScope } from "@/lib/types";

/** ขอบเขตห้องประชุม / รถ ตามสาขา ต่อกลุ่ม (ผู้ดูแลระบบสูงสุด — access.manage) */
export async function saveBookingScope(scopes: Record<BookingKind, Record<string, BookingScope>>): Promise<ActionResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/booking-scope", { method: "PUT", body: JSON.stringify(scopes) });
  } catch (e) {
    return toActionResult(e);
  }
  for (const p of ["/role-permissions", "/meeting-rooms", "/vehicles"]) revalidatePath(p);
  return { ok: true, message: t("bookingScope.saved") };
}
