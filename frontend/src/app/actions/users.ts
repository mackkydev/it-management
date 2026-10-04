"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { apiFetch } from "@/lib/api";
import type { UserFormValues } from "@/lib/types";

export type UserResult = ActionResult<keyof UserFormValues | "user">;

/** id มาจาก client (server action รับค่าอะไรก็ได้) จึงต้องตรวจก่อนนำไปต่อ URL */
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

async function invalidId(): Promise<UserResult> {
  const { t } = await getI18n();
  return { message: t("users.form.notFound") };
}

const toResult = (e: unknown) => toActionResult<keyof UserFormValues | "user">(e, "users.form.notFound");

function toPayload(v: UserFormValues, isCreate: boolean) {
  return {
    name: v.name.trim(),
    email: v.email.trim(),
    role: v.role,
    is_active: v.is_active,
    branch_id: v.branch_id ? Number(v.branch_id) : null,
    department: v.department.trim() || null,
    division: v.division.trim() || null,
    supervisor_id: v.supervisor_id ? Number(v.supervisor_id) : null,
    is_it_staff: v.is_it_staff,
    is_it_head: v.is_it_head,
    approval_route_id: v.approval_route_id ? Number(v.approval_route_id) : null,
    // แก้ไข: ส่งรหัสผ่านเฉพาะเมื่อต้องการรีเซ็ต
    ...(isCreate || v.password ? { password: v.password } : {}),
  };
}

function done(saved: "created" | "updated" | "deleted"): never {
  revalidatePath("/users");
  revalidatePath("/", "layout"); // ชื่อ/บทบาทใน sidebar ถ้า admin แก้บัญชีตัวเอง
  redirect(`/users?saved=${saved}`);
}

export async function createUser(values: UserFormValues): Promise<UserResult> {
  try {
    await apiFetch("/users", { method: "POST", body: JSON.stringify(toPayload(values, true)) });
  } catch (e) {
    return toResult(e);
  }
  done("created");
}

export async function updateUser(id: number, values: UserFormValues): Promise<UserResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/users/${id}`, { method: "PATCH", body: JSON.stringify(toPayload(values, false)) });
  } catch (e) {
    return toResult(e);
  }
  done("updated");
}

export async function deleteUser(id: number): Promise<UserResult> {
  if (!validId(id)) return invalidId();
  try {
    await apiFetch(`/users/${id}`, { method: "DELETE" });
  } catch (e) {
    const result = await toResult(e);
    // ลบไม่ได้ (มีประวัติ / ลบตัวเอง) — API ส่งเหตุผลมาที่ errors.user
    return result.errors?.user ? { message: result.errors.user } : result;
  }
  done("deleted");
}

/** Local Admin ลบ (ปิดใช้งาน) ลายเซ็นของผู้ใช้ — API บันทึก audit */
export async function deleteUserSignature(id: number): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!Number.isInteger(id) || id <= 0) return { message: t("common.saveFailed") };
  try {
    await apiFetch(`/users/${id}/signature`, { method: "DELETE" });
  } catch (e) {
    return toActionResult(e);
  }
  revalidatePath(`/users/${id}/edit`);
  return { ok: true, message: t("users.signature.removed") };
}
