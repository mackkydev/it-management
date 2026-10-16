"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { ApiError, apiFetch, reauthChallenge } from "@/lib/api";
import type { ReauthChallenge, VpnLoan } from "@/lib/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const refresh = () => {
  for (const p of ["/loans/mine", "/loans/vpn", "/loans/vpn/request"]) revalidatePath(p);
};

type Result<F extends string> = ActionResult<F> & { loan?: VpnLoan };

async function call<F extends string>(id: string | null, path: string, body: Record<string, unknown>, method = "POST"): Promise<Result<F> & { ticket?: { id: string; ticket_no: string } }> {
  const { t } = await getI18n();
  if (id !== null && !UUID_RE.test(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: VpnLoan; ticket?: { id: string; ticket_no: string } }>(path, { method, body: JSON.stringify(body) });
    refresh();
    return { ok: true, loan: res.data, ticket: res.ticket };
  } catch (e) {
    return toActionResult<F>(e);
  }
}

const date = (v: string) => (DATE_RE.test(v) ? v : null);
const text = (v: string) => v.trim() || null;

/** ผู้ใช้ยกเลิกคำขอที่ยังรอ */
export async function cancelVpnRequest(id: string) {
  return call<"status">(id, `/vpn-loans/${id}/cancel`, {});
}

/** ต่ออายุ / เลิกใช้ → ใบแจ้งงานเข้าคิว IT */
export async function chooseVpn(id: string, v: { choice: "renew" | "cancel"; renew_until: string; reason: string }) {
  return call<"choice" | "renew_until" | "reason">(id, `/vpn-loans/${id}/choice`, {
    choice: v.choice,
    renew_until: v.choice === "renew" ? date(v.renew_until) : null,
    reason: text(v.reason),
  });
}

export interface VpnAssignValues {
  credential_id: string;
  start_on: string;
  expires_on: string;
  notify_days_before: string;
}

/** มอบบัญชี (คำขอที่รอ) / แก้ไขระหว่างใช้งาน */
export async function saveVpnAssignment(id: string, mode: "assign" | "edit", v: VpnAssignValues) {
  const body = {
    credential_id: Number(v.credential_id) || null,
    start_on: date(v.start_on),
    expires_on: date(v.expires_on),
    notify_days_before: v.notify_days_before === "" ? 7 : Number(v.notify_days_before),
  };
  return mode === "assign"
    ? call<keyof VpnAssignValues | "status">(id, `/vpn-loans/${id}/assign`, body)
    : call<keyof VpnAssignValues | "status">(id, `/vpn-loans/${id}`, body, "PUT");
}

/** ไม่อนุมัติ (ต้องมีเหตุผล) / สิ้นสุดการใช้ */
export async function closeVpn(id: string, action: "reject" | "end", note: string) {
  return call<"note" | "status">(id, `/vpn-loans/${id}/${action}`, { note: text(note) });
}

/** เปิดดูรหัส VPN ของตัวเอง — reauth = ต้องยืนยันตัวตนซ้ำก่อน (API ตอบ 428) */
export async function revealVpn(id: string): Promise<{ username: string | null; password: string | null } | { error: string; reauth?: ReauthChallenge }> {
  if (!UUID_RE.test(id)) return { error: "invalid" };
  try {
    return (await apiFetch<{ data: { username: string | null; password: string | null } }>(`/vpn-loans/${id}/reveal`, { method: "POST" })).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) return { error: e.message, reauth: reauthChallenge(e) };
    if (e instanceof ApiError && e.status === 422) return { error: e.message };
    const r = await toActionResult(e);
    return { error: r.message ?? "error" };
  }
}
