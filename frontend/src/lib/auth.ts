import "server-only";

import { cache } from "react";
import { apiFetch } from "@/lib/api";
import { isAllowed, normalizeUiConfig, type UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";

/** ผู้ใช้ปัจจุบัน — cache ต่อ request เพื่อให้ layout และ page เรียกซ้ำได้โดยยิง API ครั้งเดียว */
export const getCurrentUser = cache(async () => {
  const { data } = await apiFetch<{ data: User }>("/auth/me");
  return data;
});

/** การตั้งค่าการมองเห็นเมนู/ปุ่ม + ลำดับเมนู (GET /ui-config) — cache ต่อ request */
export const getUiConfig = cache(async (): Promise<UiConfig> => {
  const { data } = await apiFetch<{ data: { ui_permissions: unknown; menu_order: unknown } }>("/ui-config");
  return normalizeUiConfig(data);
});

/** ตรวจว่าผู้ใช้ปัจจุบันเห็นเมนู/ปุ่มนี้ไหม: const can = await getAccess(); can("btn:assets:create") */
export async function getAccess(): Promise<(key: string) => boolean> {
  const [user, config] = await Promise.all([getCurrentUser(), getUiConfig()]);
  return (key) => isAllowed(config, user, key);
}

/* ใช้ซ่อน/แสดงปุ่มใน UI เท่านั้น — สิทธิ์จริงตรวจที่ Policy/Gate ฝั่ง Laravel */
export const canManageAssets = (user: User) => user.role === "admin" || user.role === "manager";
export const canDeleteAssets = (user: User) => user.role === "admin";
export const isAdmin = (user: User) => user.role === "admin";
/** เจ้าหน้าที่ฝ่าย IT (รวมหัวหน้า IT) */
export const isIt = (user: User) => Boolean(user.is_it_staff || user.is_it_head);
/** ข้อมูลของแผนก IT: คลังบัญชี/รหัสผ่าน, สัญญา, งาน IT หลังบ้าน */
export const canAccessItData = (user: User) => isAdmin(user) || isIt(user);
