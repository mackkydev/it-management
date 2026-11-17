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

/** ต่ออายุ / ไม่ต่ออายุ (เลิกใช้) / แจ้งผู้ใช้ถูกล็อก → ใบแจ้งงานเข้าคิว IT */
export async function chooseVpn(id: string, v: { choice: "renew" | "cancel" | "locked"; renew_until: string; reason: string }) {
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
    // ว่าง = ค่าตั้งต้นจากหน้าตั้งค่า (API ใช้ vpn_notify_days)
    ...(v.notify_days_before === "" ? {} : { notify_days_before: Number(v.notify_days_before) }),
  };
  return mode === "assign"
    ? call<keyof VpnAssignValues | "status">(id, `/vpn-loans/${id}/assign`, body)
    : call<keyof VpnAssignValues | "status">(id, `/vpn-loans/${id}`, body, "PUT");
}

/** ไม่อนุมัติ (ต้องมีเหตุผล) / สิ้นสุดการใช้ */
export async function closeVpn(id: string, action: "reject" | "end", note: string) {
  return call<"note" | "status">(id, `/vpn-loans/${id}/${action}`, { note: text(note) });
}

export interface VpnRequestValues {
  vpn_start_on: string;
  vpn_end_on: string;
  reason: string;
  assignee_id: string;
  approver_id: string;
  branch_id: string;
}

/**
 * ขอใช้ VPN จากหน้า ขอใช้ VPN — สร้างใบแจ้งงาน "อื่นๆ → ขอใช้งาน VPN" เบื้องหลัง (ข้อมูลชุดเดียวกับฟอร์มแจ้งงาน: สาขา / แผนก / ฝ่าย /
 * เจ้าหน้าที่ IT / ผู้อนุมัติ / ช่วงวันที่ / รายละเอียด) → ผ่านหัวหน้า → ฝ่าย IT มอบบัญชีที่หน้า จัดการ VPN
 */
export async function requestVpn(v: VpnRequestValues, user: { department: string | null; division: string | null }): Promise<ActionResult<keyof VpnRequestValues | "signature">> {
  const { t, fmt } = await getI18n();
  if (!DATE_RE.test(v.vpn_start_on) || !DATE_RE.test(v.vpn_end_on)) return { errors: { vpn_start_on: t("vpn.request.validate.dates") } };
  try {
    await apiFetch("/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "other",
        type_other: "ขอใช้งาน VPN",
        branch_id: Number(v.branch_id) || null,
        department: user.department,
        division: user.division,
        details: t("vpn.request.details", { from: fmt.date(v.vpn_start_on), until: fmt.date(v.vpn_end_on), reason: v.reason.trim() }),
        assignee_id: Number(v.assignee_id) || null,
        approver_id: Number(v.approver_id) || null,
        vpn_start_on: v.vpn_start_on,
        vpn_end_on: v.vpn_end_on,
      }),
    });
    refresh();
    revalidatePath("/tickets");
    return { ok: true };
  } catch (e) {
    const r = await toActionResult<keyof VpnRequestValues | "details" | "signature">(e);
    // ช่อง details ของใบงาน = เหตุผลในฟอร์มนี้
    if (r.errors?.details) r.errors.reason = r.errors.details;
    return r as ActionResult<keyof VpnRequestValues | "signature">;
  }
}

/** ผู้ขอกด "ได้รับแล้ว" → ปิดใบแจ้งงาน + ปุ่มดูชื่อผู้ใช้ / รหัสผ่าน */
export async function receiveVpn(id: string) {
  return call<"status">(id, `/vpn-loans/${id}/receive`, {});
}

/** ผู้จัดการฝ่าย IT อนุมัติการมอบ / ส่งกลับ (ต้องมีเหตุผล) */
export async function approveVpn(id: string, approve: boolean, note: string) {
  return call<"note" | "status" | "signature">(id, `/vpn-loans/${id}/approval`, { approve, note: text(note) });
}

/** เจ้าหน้าที่ IT เรียกคืนรหัส VPN */
export async function revokeVpn(id: string, note: string) {
  return call<"note" | "status">(id, `/vpn-loans/${id}/revoke`, { note: text(note) });
}

/** เปิดดูชื่อผู้ใช้ / รหัส VPN ของตัวเอง — ต้องกรอกรหัสผ่าน login ทุกครั้ง (ผิด = error ที่ช่องรหัสผ่าน) */
export async function revealVpn(id: string, password: string): Promise<{ username: string | null; password: string | null } | { error: string; field?: "password"; reauth?: ReauthChallenge }> {
  if (!UUID_RE.test(id)) return { error: "invalid" };
  try {
    return (await apiFetch<{ data: { username: string | null; password: string | null } }>(`/vpn-loans/${id}/reveal`, { method: "POST", body: JSON.stringify({ password }) })).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) return { error: e.message, reauth: reauthChallenge(e) };
    if (e instanceof ApiError && e.status === 422) {
      const r = await toActionResult<"password">(e);
      return r.errors?.password ? { error: r.errors.password, field: "password" } : { error: r.message ?? e.message };
    }
    const r = await toActionResult(e);
    return { error: r.message ?? "error" };
  }
}
