import "server-only";

import { cache } from "react";
import { apiFetch } from "@/lib/api";
import { has, isAllowed, isLocalSuperAdmin, isSuperAdmin, normalizeUiConfig, type UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";

/** ผู้ใช้ปัจจุบัน — cache ต่อ request เพื่อให้ layout และ page เรียกซ้ำได้โดยยิง API ครั้งเดียว */
export const getCurrentUser = cache(async () => {
  const { data } = await apiFetch<{ data: User }>("/auth/me");
  return data;
});

/** การตั้งค่าการมองเห็นเมนู/ปุ่ม + ลำดับเมนู (GET /ui-config) — cache ต่อ request */
export const getUiConfig = cache(async (): Promise<UiConfig> => {
  const { data } = await apiFetch<{ data: { ui_permissions: unknown; menu_order: unknown; role_permissions: unknown; logo_version: unknown } }>("/ui-config");
  return normalizeUiConfig(data);
});

/** ตรวจว่าผู้ใช้ปัจจุบันเห็นเมนู/ปุ่มนี้ไหม: const can = await getAccess(); can("btn:assets:create") */
export async function getAccess(): Promise<(key: string) => boolean> {
  const [user, config] = await Promise.all([getCurrentUser(), getUiConfig()]);
  return (key) => isAllowed(config, user, key);
}

/*
 * ใช้ซ่อน/แสดงหน้าและปุ่มใน UI เท่านั้น — สิทธิ์จริงตรวจที่ API (permission key ใน express/src/models/permission.ts)
 * has(user, key) = สิทธิ์จาก GET /auth/me (สิทธิ์ของกลุ่ม + เพิ่ม/ถอดรายคน)
 */
export { has, isLocalSuperAdmin, isSuperAdmin };
export const canCreateAssets = (user: User) => has(user, "assets.create");
export const canEditAssets = (user: User) => has(user, "assets.update");
/** เพิ่มหรือแก้ไขสินทรัพย์ได้ (ตัวเลือกในฟอร์ม / ปุ่มนำเข้า) */
export const canManageAssets = (user: User) => canCreateAssets(user) || canEditAssets(user);
/** เห็นสินทรัพย์ทั้งหมด — ไม่มี = เห็นเฉพาะที่ตัวเองถือครอง (API กรองให้) */
export const canViewAllAssets = (user: User) => has(user, "assets.view_all") || canManageAssets(user);
export const canDeleteAssets = (user: User) => has(user, "assets.delete");
export const canDeleteLocations = (user: User) => has(user, "locations.delete");
