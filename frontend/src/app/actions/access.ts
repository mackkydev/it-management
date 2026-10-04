"use server";

import { revalidatePath } from "next/cache";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { ApiConnection, ApiConnectionTest, SyncResult, UserPermissionView } from "@/lib/types";

/** API User / สิทธิ์รายคน / การเชื่อมต่อ API — Local Admin เท่านั้น (API ตรวจซ้ำทุกครั้ง) */

const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

export type PermissionResult = ActionResult & { data?: UserPermissionView };

/** บันทึกบทบาท (API User: manager / viewer) + เพิ่ม/ถอดสิทธิ์รายคน (inherit = ตามกลุ่ม) */
export async function saveUserPermissions(
  userId: number,
  payload: { role?: "manager" | "viewer"; overrides: Record<string, "allow" | "deny" | "inherit"> },
): Promise<PermissionResult> {
  const { t } = await getI18n();
  if (!validId(userId)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: UserPermissionView }>(`/users/${userId}/permissions`, { method: "PUT", body: JSON.stringify(payload) });
    revalidatePath("/api-users");
    revalidatePath(`/api-users/${userId}`);
    return { ok: true, message: t("access.saved"), data: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/** ผูก API User กับบัญชี LOCAL เดิม (กรณีอีเมลซ้ำ) */
export async function linkApiUser(apiUserId: number, localUserId: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(apiUserId) || !validId(localUserId)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/api-users/${apiUserId}/link`, { method: "POST", body: JSON.stringify({ local_user_id: localUserId }) });
  } catch (e) {
    const r = await toActionResult(e);
    return { ...r, message: Object.values(r.errors ?? {})[0] ?? r.message };
  }
  revalidatePath("/api-users");
  return { ok: true, message: t("access.linked") };
}

/* ---------------------------------------------------------------- การเชื่อมต่อ API */

export type ConnectionPayload = Omit<ApiConnection, "id" | "has_auth_secret" | "users_count" | "created_at" | "updated_at" | "last_synced_at" | "last_sync_result"> & {
  auth_secret?: string;
  clear_auth_secret?: boolean;
};

export type ConnectionResult = ActionResult & { id?: number };

export async function saveConnection(id: number | null, payload: ConnectionPayload): Promise<ConnectionResult> {
  const { t } = await getI18n();
  if (id !== null && !validId(id)) return { message: t("common.saveFailed") };
  // secret ว่าง = ไม่เปลี่ยน (ไม่ส่งไป API)
  const body: Record<string, unknown> = { ...payload };
  if (!payload.auth_secret) delete body.auth_secret;
  try {
    const res = await apiFetch<{ data: ApiConnection }>(id ? `/api-connections/${id}` : "/api-connections", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
    revalidatePath("/api-connections");
    revalidatePath("/login");
    return { ok: true, message: id ? t("apiConnections.updated") : t("apiConnections.created"), id: res.data.id };
  } catch (e) {
    return toActionResult(e);
  }
}

export async function deleteConnection(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/api-connections/${id}`, { method: "DELETE" });
  } catch (e) {
    const r = await toActionResult(e);
    return { ...r, message: Object.values(r.errors ?? {})[0] ?? r.message };
  }
  revalidatePath("/api-connections");
  revalidatePath("/login");
  return { ok: true, message: t("apiConnections.deleted") };
}

/** ทดสอบด้วยบัญชีจริงของต้นทาง — รหัสผ่านส่งต่อไป API เท่านั้น ไม่เก็บ */
export async function testConnection(id: number, username: string, password: string): Promise<ActionResult & { data?: ApiConnectionTest }> {
  const { t } = await getI18n();
  if (!validId(id) || !username || !password) return { message: t("auth.requiredUsername") };
  try {
    const res = await apiFetch<{ data: ApiConnectionTest }>(`/api-connections/${id}/test`, { method: "POST", body: JSON.stringify({ username, password }) });
    return { ok: true, data: res.data };
  } catch (e) {
    return toActionResult(e);
  }
}

/** กำหนดสิทธิ์ทั้งชุดของกลุ่ม (บทบาท / it_staff / it_head) */
export async function saveRolePermissions(group: string, keys: string[]): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!/^[a-z_]{1,30}$/.test(group)) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/permissions/roles/${group}`, { method: "PUT", body: JSON.stringify({ keys }) });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath("/role-permissions");
  revalidatePath("/permissions");
  return { ok: true, message: t("rolePermissions.saved") };
}

/** ซิงค์รายชื่อผู้ใช้จากต้นทางตอนนี้ */
export async function syncNow(id: number): Promise<ActionResult & { data?: SyncResult }> {
  const { t } = await getI18n();
  if (!validId(id)) return { message: t("common.saveFailed") };
  try {
    const res = await apiFetch<{ data: SyncResult }>(`/api-connections/${id}/sync`, { method: "POST" });
    revalidatePath(`/api-connections/${id}`);
    revalidatePath("/api-users");
    return { ok: res.data.ok, data: res.data };
  } catch (e) {
    const r = await toActionResult(e);
    return { ...r, message: Object.values(r.errors ?? {})[0] ?? r.message };
  }
}
