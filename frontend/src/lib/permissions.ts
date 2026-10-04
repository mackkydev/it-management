import type { MessageKey } from "@/i18n/types";
import type { User } from "@/lib/types";

/**
 * สิทธิ์การมองเห็นเมนู/ปุ่ม (ตั้งค่าที่หน้า "สิทธิ์การใช้งาน" — เก็บใน app_settings: ui_permissions, menu_order)
 * - เป็นการ "ซ่อน" เพิ่มจากสิทธิ์เดิมเท่านั้น: เมนูที่ระบบไม่อนุญาตอยู่แล้ว จะไม่แสดงแม้ตั้งให้เห็น
 * - สิทธิ์จริงตรวจที่ API เสมอ (ซ่อนปุ่มไม่ได้แปลว่าเรียก API ไม่ได้)
 */
export const AUDIENCES = ["admin", "division_manager", "manager", "viewer", "it_staff", "it_head"] as const;
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
  /** สิทธิ์ (permission key) ของแต่ละกลุ่มจาก API — ใช้จำลองว่าแต่ละกลุ่มเข้าเมนู/ปุ่มใดได้ */
  role_permissions: Partial<Record<Audience, string[]>>;
  /** เวอร์ชันโลโก้ระบบ (null = ไม่มีโลโก้ → แสดง icon เดิม) */
  logo_version: string | null;
}

/** PHP ส่ง object ว่างเป็น [] — แปลงให้เป็น object เสมอ */
export function normalizeUiConfig(raw: { ui_permissions?: unknown; menu_order?: unknown; role_permissions?: unknown; logo_version?: unknown } | null | undefined): UiConfig {
  const obj = <T,>(v: unknown): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));
  return {
    ui_permissions: obj<UiPermissions>(raw?.ui_permissions),
    menu_order: obj<MenuOrder>(raw?.menu_order),
    role_permissions: obj<Partial<Record<Audience, string[]>>>(raw?.role_permissions),
    logo_version: typeof raw?.logo_version === "string" && raw.logo_version ? raw.logo_version : null,
  };
}

export const EMPTY_UI_CONFIG: UiConfig = { ui_permissions: {}, menu_order: {}, role_permissions: {}, logo_version: null };

/**
 * ผู้ใช้มีสิทธิ์ (permission key) นี้ไหม — ค่าจาก GET /auth/me (permissions) ซึ่ง API คำนวณจาก
 * สิทธิ์ของกลุ่ม + เพิ่ม/ถอดรายคน; Local Admin ผ่านทุกสิทธิ์ ใช้ซ่อน/แสดง UI เท่านั้น — สิทธิ์จริงตรวจที่ API
 */
export function has(user: User, key: string): boolean {
  if (user.role === "admin" && user.type !== "API") return true;
  return user.permissions?.includes(key) ?? false;
}

/** Local Admin — ผู้เดียวที่ตั้งค่าการเชื่อมต่อ API / สิทธิ์ของผู้ใช้ / การมองเห็นเมนูได้ */
export const isLocalAdmin = (user: User) => user.role === "admin" && user.type !== "API";

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
  if (isLocalAdmin(user) && ALWAYS_FOR_ADMIN.has(key)) return true;
  const denied = config.ui_permissions[key];
  if (!denied || denied.length === 0) return true;
  return audiencesOf(user).some((a) => !denied.includes(a));
}

/** ปุ่มที่ตั้งค่าการมองเห็นได้ (key "btn:<หน้า>:<ปุ่ม>" — ห้ามมีจุด เพราะ validator ของ API ใช้จุดแยก path) */
const perm = (key: string) => (u: User) => has(u, key);

/** system = สิทธิ์เดิมของระบบ (ไม่ระบุ = ทุกคน) — ใช้แสดงช่องที่ตั้งไม่ได้ในหน้าสิทธิ์ */
export const BUTTONS: { key: string; label: MessageKey; system?: (u: User) => boolean }[] = [
  { key: "btn:tickets:create", label: "permissions.buttons.ticketCreate" },
  { key: "btn:tickets:print", label: "permissions.buttons.ticketPrint" },
  { key: "btn:kpi:create", label: "permissions.buttons.kpiCreate" },
  { key: "btn:assets:create", label: "permissions.buttons.assetCreate", system: perm("assets.manage") },
  { key: "btn:assets:edit", label: "permissions.buttons.assetEdit", system: perm("assets.manage") },
  { key: "btn:vault:create", label: "permissions.buttons.vaultCreate", system: perm("vault.use") },
  { key: "btn:vault:reveal", label: "permissions.buttons.vaultReveal", system: perm("vault.use") },
  { key: "btn:contracts:create", label: "permissions.buttons.contractCreate", system: perm("contracts.manage") },
  { key: "btn:locations:create", label: "permissions.buttons.locationCreate", system: perm("assets.manage") },
  { key: "btn:users:create", label: "permissions.buttons.userCreate", system: perm("users.manage") },
];

/** ผู้ใช้ตัวอย่างของแต่ละกลุ่ม (สิทธิ์จากตารางสิทธิ์ของกลุ่ม) — ใช้แสดงช่องที่ระบบไม่อนุญาตในหน้าการมองเห็น */
export function sampleUser(a: Audience, config: UiConfig): User {
  const base = { id: 0, name: "", email: "", type: "LOCAL" as const };
  const perms = (x: Audience) => config.role_permissions[x] ?? [];
  switch (a) {
    case "it_staff":
      return { ...base, role: "viewer", is_it_staff: true, permissions: [...perms("viewer"), ...perms("it_staff")] };
    case "it_head":
      return { ...base, role: "viewer", is_it_head: true, permissions: [...perms("viewer"), ...perms("it_head")] };
    default:
      return { ...base, role: a, permissions: perms(a) };
  }
}

/**
 * เรียงรายการตามลำดับที่บันทึกไว้ — รายการที่ไม่อยู่ในลำดับ (เมนูใหม่) วางไว้หน้ารายการถัดไปตามลำดับเดิม
 * (ไม่ไปกองท้ายสุด) ถ้าไม่มีรายการถัดไปที่รู้จักจึงต่อท้าย
 */
export function sortByOrder<T>(list: T[], order: string[] | undefined, key: (x: T) => string): T[] {
  if (!order?.length) return list;
  const rank = new Map(order.map((k, i) => [k, i]));
  const rankAt = (i: number): number => {
    const own = rank.get(key(list[i]));
    if (own !== undefined) return own;
    for (let j = i + 1; j < list.length; j++) {
      const next = rank.get(key(list[j]));
      if (next !== undefined) return next - 1 + (i + 1) / (list.length + 1); // อยู่ระหว่าง next-1 กับ next
    }
    return 1e6 + i;
  };
  return list.map((x, i) => ({ x, r: rankAt(i) })).sort((a, b) => a.r - b.r).map(({ x }) => x);
}
