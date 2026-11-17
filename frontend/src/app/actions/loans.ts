"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch } from "@/lib/api";
import type { Loan, LoanDevice } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const refresh = () => {
  for (const p of ["/loans", "/loans/mine", "/loans/manage"]) revalidatePath(p);
};

/** การยืมที่คาบเกี่ยวช่วงวัน (เปลี่ยนเดือน / ตรวจอุปกรณ์ว่างในฟอร์ม) — ช่วงไม่เกิน 62 วัน */
export async function loadLoans(from: string, to: string): Promise<Loan[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return [];
  try {
    return (await apiFetch<{ data: Loan[] }>(`/loans?${new URLSearchParams({ from, to })}`)).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export async function loadLoanDevices(): Promise<LoanDevice[]> {
  try {
    return (await apiFetch<{ data: LoanDevice[] }>("/loan-devices")).data;
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export interface LoanValues {
  asset_id: string;
  purpose: string;
  note: string;
  start_on: string;
  start_time: string;
  end_on: string;
  end_time: string;
}

/** จองยืม (id = null) / แก้ไขการจอง */
export async function saveLoan(id: string | null, v: LoanValues): Promise<ActionResult<keyof LoanValues> & { loan?: Loan }> {
  const { t } = await getI18n();
  if (id !== null && !UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: Loan }>(id ? `/loans/${id}` : "/loans", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        asset_id: Number(v.asset_id) || null,
        purpose: v.purpose.trim(),
        note: v.note.trim() || null,
        start_on: v.start_on,
        start_time: v.start_time,
        end_on: v.end_on,
        end_time: v.end_time,
      }),
    });
    refresh();
    return { ok: true, loan: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/**
 * เตรียมเครื่อง / ส่งมอบ (form: asset_id, accessories[], photos[]) และยืนยันรับคืน (form: returned_accessories[], note, photos[]) — ผู้จัดการ
 * ส่ง multipart ต่อไปที่ API (รูปย่อแล้วฝั่งเบราว์เซอร์)
 */
export async function loanStep(id: string, step: "hand-out" | "return", form: FormData): Promise<ActionResult<"asset_id" | "accessories" | "returned_accessories" | "photos" | "note" | "status"> & { loan?: Loan }> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: Loan }>(`/loans/${id}/${step}`, { method: "POST", body: form });
    refresh();
    return { ok: true, loan: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/** ยกเลิก / ผู้ยืมกดคืนเครื่อง */
export async function loanAction(id: string, action: "cancel" | "request-return"): Promise<ActionResult<"status" | "note"> & { loan?: Loan }> {
  const { t } = await getI18n();
  if (!UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: Loan }>(`/loans/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    refresh();
    return { ok: true, loan: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}
