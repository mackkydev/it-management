import type { MessageKey } from "@/i18n/types";
import type { User } from "@/lib/types";

/**
 * สิทธิ์การมองเห็นเมนู/ปุ่ม (ตั้งค่าที่หน้า "สิทธิ์การใช้งาน" — เก็บใน app_settings: ui_permissions, menu_order)
 * - เป็นการ "ซ่อน" เพิ่มจากสิทธิ์เดิมเท่านั้น: เมนูที่ระบบไม่อนุญาตอยู่แล้ว จะไม่แสดงแม้ตั้งให้เห็น
 * - สิทธิ์จริงตรวจที่ API เสมอ (ซ่อนปุ่มไม่ได้แปลว่าเรียก API ไม่ได้)
 */
export const AUDIENCES = ["admin", "manager", "viewer", "it_staff", "it_head"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** key → กลุ่มผู้ใช้ที่ "ไม่ให้เห็น" (ไม่มี key = ทุกกลุ่มเห็น) */
export type UiPermissions = Record<string, Audience[]>;

/** ลำดับเมนู: groups = ลำดับกลุ่ม, items[groupId] = ลำดับ href ในกลุ่ม */
export interface MenuOrder {
  groups?: string[];
  items?: Record<string, string[]>;
}

export interface UiConfig {
  ui_permissions: UiPermissions;
  menu_order: MenuOrder;
}

/** PHP ส่ง object ว่างเป็น [] — แปลงให้เป็น object เสมอ */
export function normalizeUiConfig(raw: { ui_permissions?: unknown; menu_order?: unknown } | null | undefined): UiConfig {
  const obj = <T,>(v: unknown): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));
  return { ui_permissions: obj<UiPermissions>(raw?.ui_permissions), menu_order: obj<MenuOrder>(raw?.menu_order) };
}

export const EMPTY_UI_CONFIG: UiConfig = { ui_permissions: {}, menu_order: {} };

/** หน้าที่ admin ต้องเห็นเสมอ (กันล็อกตัวเองออกจากหน้าตั้งค่าสิทธิ์) */
export const ALWAYS_FOR_ADMIN = new Set(["/permissions"]);

export function audiencesOf(user: User): Audience[] {
  const list: Audience[] = [user.role];
  if (user.is_it_staff) list.push("it_staff");
  if (user.is_it_head) list.push("it_head");
  return list;
}

/** เห็นถ้าผู้ใช้อยู่ในกลุ่มที่ไม่ถูกซ่อนอย่างน้อย 1 กลุ่ม */
export function isAllowed(config: UiConfig, user: User, key: string): boolean {
  if (user.role === "admin" && ALWAYS_FOR_ADMIN.has(key)) return true;
  const denied = config.ui_permissions[key];
  if (!denied || denied.length === 0) return true;
  return audiencesOf(user).some((a) => !denied.includes(a));
}

/** ปุ่มที่ตั้งค่าการมองเห็นได้ (key "btn:<หน้า>:<ปุ่ม>" — ห้ามมีจุด เพราะ validator ของ API ใช้จุดแยก path) */
const managers = (u: User) => u.role === "admin" || u.role === "manager";
const itData = (u: User) => u.role === "admin" || Boolean(u.is_it_staff || u.is_it_head);

/** system = สิทธิ์เดิมของระบบ (ไม่ระบุ = ทุกคน) — ใช้แสดงช่องที่ตั้งไม่ได้ในหน้าสิทธิ์ */
export const BUTTONS: { key: string; label: MessageKey; system?: (u: User) => boolean }[] = [
  { key: "btn:tickets:create", label: "permissions.buttons.ticketCreate" },
  { key: "btn:tickets:print", label: "permissions.buttons.ticketPrint" },
  { key: "btn:kpi:create", label: "permissions.buttons.kpiCreate" },
  { key: "btn:assets:create", label: "permissions.buttons.assetCreate", system: managers },
  { key: "btn:assets:edit", label: "permissions.buttons.assetEdit", system: managers },
  { key: "btn:vault:create", label: "permissions.buttons.vaultCreate", system: itData },
  { key: "btn:vault:reveal", label: "permissions.buttons.vaultReveal", system: itData },
  { key: "btn:contracts:create", label: "permissions.buttons.contractCreate", system: itData },
  { key: "btn:locations:create", label: "permissions.buttons.locationCreate", system: managers },
  { key: "btn:users:create", label: "permissions.buttons.userCreate", system: (u) => u.role === "admin" },
];

/** ผู้ใช้ตัวอย่างของแต่ละกลุ่ม — ใช้ตรวจสิทธิ์เดิมของระบบ */
export function sampleUser(a: Audience): User {
  const base = { id: 0, name: "", email: "" };
  switch (a) {
    case "it_staff":
      return { ...base, role: "viewer", is_it_staff: true };
    case "it_head":
      return { ...base, role: "viewer", is_it_head: true };
    default:
      return { ...base, role: a };
  }
}

/** เรียงรายการตามลำดับที่บันทึกไว้ — รายการที่ไม่อยู่ในลำดับ (เมนูใหม่) ต่อท้ายตามลำดับเดิม */
export function sortByOrder<T>(list: T[], order: string[] | undefined, key: (x: T) => string): T[] {
  if (!order?.length) return list;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => (rank.get(key(a)) ?? 1e6 + list.indexOf(a)) - (rank.get(key(b)) ?? 1e6 + list.indexOf(b)));
}
