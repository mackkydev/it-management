"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { UiConfig } from "@/lib/permissions";
import type { AppSettings } from "@/lib/types";

export type ItResult = ActionResult<string>;

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

async function notFound(): Promise<ItResult> {
  const { t } = await getI18n();
  return { message: t("common.saveFailed") };
}

/** ข้อความของ errors.<key> จาก API (กรณีลบไม่ได้) ใช้เป็นข้อความหลัก */
async function blocked(e: unknown, key: string): Promise<ItResult> {
  const r = await toActionResult(e);
  return r.errors?.[key] ? { message: r.errors[key] } : r;
}

/* ---------------- สาขา (admin) ---------------- */

export async function saveBranch(id: number | null, values: { code: string; name: string; sort_order: number; is_active: boolean }): Promise<ItResult> {
  const { t } = await getI18n();
  try {
    await apiFetch(id ? `/branches/${id}` : "/branches", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ ...values, code: values.code.trim().toUpperCase(), name: values.name.trim() }),
    });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/branches");
  return { ok: true, message: t("branches.saved") };
}

export async function deleteBranch(id: number): Promise<ItResult> {
  if (!validId(id)) return notFound();
  const { t } = await getI18n();
  try {
    await apiFetch(`/branches/${id}`, { method: "DELETE" });
  } catch (e) {
    return blocked(e, "branch");
  }
  revalidatePath("/branches");
  return { ok: true, message: t("branches.deleted") };
}

/* ---------------- ตั้งค่าการแจ้งเตือน (admin) ---------------- */

export async function saveSettings(values: Partial<AppSettings>): Promise<ItResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/settings", { method: "PUT", body: JSON.stringify(values) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/settings");
  return { ok: true, message: t("settingsPage.saved") };
}

/** ตัวเลือกเรื่อง "อื่นๆ" ในใบแจ้งงาน (ข้อมูลหลัก — admin) */
export async function saveTicketOtherTypes(items: string[]): Promise<ItResult> {
  const { t } = await getI18n();
  try {
    await apiFetch("/settings", { method: "PUT", body: JSON.stringify({ ticket_other_types: items }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/ticket-types");
  revalidatePath("/tickets/new");
  return { ok: true, message: t("ticketTypes.saved") };
}

/* ---------------- สิทธิ์การใช้งาน (admin) ---------------- */

/** บันทึกการมองเห็นเมนู/ปุ่ม + ลำดับเมนู (PUT /settings เฉพาะ 2 คีย์นี้) */
export async function saveUiConfig(values: Pick<UiConfig, "ui_permissions" | "menu_order">): Promise<ItResult> {
  const { t } = await getI18n();
  // ไม่บันทึกรายการที่ไม่ได้ซ่อนกลุ่มไหนเลย
  const ui_permissions = Object.fromEntries(Object.entries(values.ui_permissions).filter(([, denied]) => denied.length > 0));
  try {
    await apiFetch("/settings", { method: "PUT", body: JSON.stringify({ ui_permissions, menu_order: values.menu_order }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/", "layout"); // เมนูทุกหน้าเปลี่ยนตาม
  return { ok: true, message: t("permissions.saved") };
}

/* ---------------- คลังบัญชี/รหัสผ่าน ---------------- */

export interface CredentialPayload {
  title: string;
  category: string;
  url: string;
  username: string;
  /** undefined = คงเดิม, "" = ลบ */
  password?: string;
  secret_notes?: string;
  notes: string;
  branch_id: string;
  expires_at: string;
}

export async function saveCredential(id: number | null, v: CredentialPayload): Promise<ItResult> {
  const body: Record<string, unknown> = {
    title: v.title.trim(),
    category: v.category,
    url: v.url.trim() || null,
    username: v.username.trim() || null,
    notes: v.notes.trim() || null,
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    expires_at: v.expires_at || null,
  };
  if (v.password !== undefined) body.password = v.password === "" ? null : v.password;
  if (v.secret_notes !== undefined) body.secret_notes = v.secret_notes === "" ? null : v.secret_notes;

  try {
    await apiFetch(id ? `/credentials/${id}` : "/credentials", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/vault");
  redirect(`/vault?saved=${id ? "updated" : "created"}`);
}

export async function deleteCredential(id: number): Promise<ItResult> {
  if (!validId(id)) return notFound();
  try {
    await apiFetch(`/credentials/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/vault");
  redirect("/vault?saved=deleted");
}

/** เปิดดูรหัสผ่าน — API บันทึก log ผู้เปิดดูทุกครั้ง */
export async function revealCredential(id: number): Promise<{ password: string | null; secret_notes: string | null } | { error: string }> {
  if (!validId(id)) return { error: "invalid" };
  try {
    const res = await apiFetch<{ data: { password: string | null; secret_notes: string | null } }>(`/credentials/${id}/reveal`, { method: "POST" });
    return res.data;
  } catch (e) {
    const r = await toActionResult(e);
    return { error: r.message ?? "error" };
  }
}

export async function credentialLogs(id: number): Promise<{ id: number; action: string; user: { name: string } | null; ip: string | null; created_at: string }[]> {
  if (!validId(id)) return [];
  try {
    return (await apiFetch<{ data: { id: number; action: string; user: { name: string } | null; ip: string | null; created_at: string }[] }>(`/credentials/${id}/logs`)).data;
  } catch {
    return [];
  }
}

/* ---------------- สัญญา vendor ---------------- */

export interface ContractPayload {
  title: string;
  vendor_name: string;
  contract_no: string;
  start_date: string;
  end_date: string;
  amount: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  notify_enabled: boolean;
  notify_days_before: string;
  notes: string;
  branch_id: string;
}

export async function saveContract(id: number | null, v: ContractPayload): Promise<ItResult> {
  const text = (s: string) => s.trim() || null;
  const body = {
    title: v.title.trim(),
    vendor_name: v.vendor_name.trim(),
    contract_no: text(v.contract_no),
    start_date: v.start_date,
    end_date: v.end_date,
    amount: text(v.amount),
    contact_name: text(v.contact_name),
    contact_email: text(v.contact_email),
    contact_phone: text(v.contact_phone),
    notify_enabled: v.notify_enabled,
    notify_days_before: v.notify_days_before ? Number(v.notify_days_before) : null,
    notes: text(v.notes),
    branch_id: v.branch_id ? Number(v.branch_id) : null,
  };
  try {
    await apiFetch(id ? `/contracts/${id}` : "/contracts", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/contracts");
  redirect(`/contracts?saved=${id ? "updated" : "created"}`);
}

export async function deleteContract(id: number): Promise<ItResult> {
  if (!validId(id)) return notFound();
  try {
    await apiFetch(`/contracts/${id}`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/contracts");
  redirect("/contracts?saved=deleted");
}
