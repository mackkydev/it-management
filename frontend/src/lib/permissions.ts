import type { MessageKey } from "@/i18n/types";
import { ROLES, type User } from "@/lib/types";

/**
 * สิทธิ์การมองเห็นเมนู/ปุ่ม (ตั้งค่าที่หน้า "สิทธิ์การใช้งาน" — เก็บใน app_settings: ui_permissions, menu_order)
 * - เป็นการ "ซ่อน" เพิ่มจากสิทธิ์เดิมเท่านั้น: เมนูที่ระบบไม่อนุญาตอยู่แล้ว จะไม่แสดงแม้ตั้งให้เห็น
 * - สิทธิ์จริงตรวจที่ API เสมอ (ซ่อนปุ่มไม่ได้แปลว่าเรียก API ไม่ได้)
 */
/** กลุ่มผู้ใช้ = key ของกลุ่มสิทธิ์ (กลุ่มตามตำแหน่ง super_admin / admin / ... หรือกลุ่มที่สร้างเอง) — รายการจาก GET /permissions */
export type Audience = string;

/** key → กลุ่มผู้ใช้ที่ "ไม่ให้เห็น" (ไม่มี key = ทุกกลุ่มเห็น) */
export type UiPermissions = Record<string, Audience[]>;

/** ลำดับเมนู: groups = ลำดับกลุ่ม, items[groupId] = ลำดับ href ในกลุ่ม */
export interface MenuOrder {
  groups?: string[];
  items?: Record<string, string[]>;
}

/** ชื่อเมนูที่แก้เอง { "<group id | /href>": { th, en } } — ไม่มี = ชื่อตั้งต้นจากไฟล์แปล */
export type MenuLabels = Record<string, { th: string; en: string }>;

/** เมนูเฉพาะสาขา { "/href": [branchId, ...] } — ไม่มี key = ทุกสาขา */
export type MenuBranches = Record<string, number[]>;

export interface UiConfig {
  ui_permissions: UiPermissions;
  menu_order: MenuOrder;
  menu_labels: MenuLabels;
  menu_branches: MenuBranches;
  /** สิทธิ์ (permission key) ของแต่ละกลุ่มจาก API — ใช้จำลองว่าแต่ละกลุ่มเข้าเมนู/ปุ่มใดได้ */
  role_permissions: Record<Audience, string[]>;
  /** เวอร์ชันโลโก้ระบบ (null = ไม่มีโลโก้ → แสดง icon เดิม) */
  logo_version: string | null;
}

/** PHP ส่ง object ว่างเป็น [] — แปลงให้เป็น object เสมอ */
export function normalizeUiConfig(
  raw: { ui_permissions?: unknown; menu_order?: unknown; menu_labels?: unknown; menu_branches?: unknown; role_permissions?: unknown; logo_version?: unknown } | null | undefined,
): UiConfig {
  const obj = <T,>(v: unknown): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : ({} as T));
  return {
    ui_permissions: obj<UiPermissions>(raw?.ui_permissions),
    menu_order: obj<MenuOrder>(raw?.menu_order),
    menu_labels: obj<MenuLabels>(raw?.menu_labels),
    menu_branches: obj<MenuBranches>(raw?.menu_branches),
    role_permissions: obj<Record<Audience, string[]>>(raw?.role_permissions),
    logo_version: typeof raw?.logo_version === "string" && raw.logo_version ? raw.logo_version : null,
  };
}

export const EMPTY_UI_CONFIG: UiConfig = { ui_permissions: {}, menu_order: {}, menu_labels: {}, menu_branches: {}, role_permissions: {}, logo_version: null };

/**
 * ผู้ใช้มีสิทธิ์ (permission key) นี้ไหม — ค่าจาก GET /auth/me (permissions) ซึ่ง API คำนวณจาก
 * สิทธิ์ของทุกกลุ่ม + เพิ่ม/ถอดรายคน; ผู้ดูแลระบบ (super_admin) ผ่านทุกสิทธิ์ ใช้ซ่อน/แสดง UI เท่านั้น — สิทธิ์จริงตรวจที่ API
 */
/** เปิดเมนู/หน้าสินทรัพย์ได้ — assets.view (ของที่ถือครอง, ผู้ใช้ทั่วไปไม่มีเป็นค่าตั้งต้น) / view_all / เพิ่ม-แก้ไข (ตรงกับ seesAssets ใน express routes/assets.ts) */
export const canViewAssets = (user: User) => has(user, "assets.view") || has(user, "assets.view_all") || has(user, "assets.create") || has(user, "assets.update");
/** เมนู License ซอฟต์แวร์ (/licenses) — ตรงกับ viewsLicenses ใน express routes/license-installations.ts */
export const canViewLicenses = (user: User) => has(user, "licenses.install") || has(user, "assets.view_all") || has(user, "assets.create") || has(user, "assets.update");

export function has(user: User, key: string): boolean {
  if (isSuperAdmin(user)) return true;
  return user.permissions?.includes(key) ?? false;
}

/** ผู้ดูแลระบบ (super_admin — ผู้ใช้ LOCAL หรือ API) */
export const isSuperAdmin = (user: Pick<User, "role">) => user.role === "super_admin";
/** ผู้ตรวจสอบ (อ่านอย่างเดียว) — API ปฏิเสธการแก้ไขทั้งหมด หน้าเว็บซ่อนปุ่ม/หน้าเพิ่ม-แก้ไข */
export const isReadOnly = (user: Pick<User, "role">) => user.role === "auditor";
/** เมนู/หน้าที่มีไว้เพิ่ม-แก้ไขอย่างเดียว ผู้ตรวจสอบเปิดไม่ได้ */
export const READ_ONLY_HIDDEN = /\/(new|edit)$|^\/(meeting-rooms|vehicles|zoom)\/book$|^\/loans\/vpn\/request$/;

/** ผู้ดูแลระบบบัญชี LOCAL — ผู้เดียวที่ตั้งค่าการเชื่อมต่อ API ได้ */
export const isLocalSuperAdmin = (user: User) => isSuperAdmin(user) && user.type !== "API";

/** หน้าที่ต้องเห็นเสมอสำหรับผู้มีสิทธิ์จัดการสิทธิ์ (กันล็อกตัวเองออกจากหน้าตั้งค่าสิทธิ์) */
export const ALWAYS_FOR_ADMIN = new Set(["/permissions", "/role-permissions"]);

/** กลุ่มที่มีผลของผู้ใช้ (ตำแหน่ง + กลุ่มที่มอบเพิ่ม) จาก GET /auth/me */
export function audiencesOf(user: User): Audience[] {
  return user.groups?.length ? user.groups : [user.role];
}

/** เห็นถ้าผู้ใช้อยู่ในกลุ่มที่ไม่ถูกซ่อนอย่างน้อย 1 กลุ่ม และสาขาตรงกับที่ตั้งไว้ (ไม่มีสาขา = เห็นเฉพาะเมนูทุกสาขา, super_admin = ทุกสาขา) */
export function isAllowed(config: UiConfig, user: User, key: string): boolean {
  // ผู้ตรวจสอบ: ปุ่มเหลือแค่ส่งออก / พิมพ์
  if (isReadOnly(user) && (key.startsWith("btn:") ? !/:(export|print)$/.test(key) : READ_ONLY_HIDDEN.test(key))) return false;
  if (has(user, "access.manage") && ALWAYS_FOR_ADMIN.has(key)) return true;
  const branches = config.menu_branches?.[key];
  if (branches?.length && !isSuperAdmin(user) && !(user.branch_id && branches.includes(Number(user.branch_id)))) return false;
  const denied = config.ui_permissions[key];
  if (!denied || denied.length === 0) return true;
  return audiencesOf(user).some((a) => !denied.includes(a));
}

/** ปุ่มที่ตั้งค่าการมองเห็นได้ (key "btn:<หน้า>:<ปุ่ม>" — ห้ามมีจุด เพราะ validator ของ API ใช้จุดแยก path) */
const perm = (key: string) => (u: User) => has(u, key);

/**
 * page = หน้าที่ปุ่มอยู่ (ชื่อเมนูจากไฟล์แปล — หน้าสิทธิ์จัดกลุ่มตามนี้ เรียงตามลำดับในรายการ)
 * system = สิทธิ์เดิมของระบบ (ไม่ระบุ = ทุกคน) — ใช้แสดงช่องที่ตั้งไม่ได้ในหน้าสิทธิ์
 */
export const BUTTONS: { key: string; page: MessageKey; label: MessageKey; system?: (u: User) => boolean }[] = [
  { key: "btn:tickets:create", page: "nav.ticketMine", label: "permissions.buttons.ticketCreate" },
  { key: "btn:tickets:print", page: "nav.ticketMine", label: "permissions.buttons.ticketPrint" },
  { key: "btn:calendar:event", page: "nav.calendar", label: "permissions.buttons.calendarEvent" },
  { key: "btn:calendar:ical", page: "nav.calendar", label: "permissions.buttons.calendarIcal" },
  { key: "btn:leave:create", page: "nav.leaveMine", label: "permissions.buttons.leaveCreate" },
  { key: "btn:leave:export", page: "nav.leaveMine", label: "permissions.buttons.leaveExport" },
  { key: "btn:meeting:book", page: "nav.meetingGroup", label: "permissions.buttons.meetingBook" },
  { key: "btn:meeting:room-create", page: "nav.meetingGroup", label: "permissions.buttons.meetingRoomCreate", system: perm("meeting.rooms") },
  { key: "btn:vehicles:book", page: "nav.vehicleGroup", label: "permissions.buttons.vehicleBook" },
  { key: "btn:vehicles:create", page: "nav.vehicleGroup", label: "permissions.buttons.vehicleCreate", system: perm("vehicle.manage") },
  { key: "btn:loans:book", page: "nav.loanGroup", label: "permissions.buttons.loanBook" },
  { key: "btn:kpi:create", page: "nav.kpi", label: "permissions.buttons.kpiCreate", system: perm("kpi.use") },
  { key: "btn:kpi:export", page: "nav.kpi", label: "permissions.buttons.kpiExport", system: perm("kpi.use") },
  { key: "btn:vault:create", page: "nav.vault", label: "permissions.buttons.vaultCreate", system: perm("vault.create") },
  { key: "btn:vault:reveal", page: "nav.vault", label: "permissions.buttons.vaultReveal", system: perm("vault.view") },
  { key: "btn:contracts:create", page: "nav.contracts", label: "permissions.buttons.contractCreate", system: perm("contracts.create") },
  { key: "btn:licenses:create", page: "nav.licenses", label: "permissions.buttons.licenseCreate", system: perm("assets.create") },
  { key: "btn:licenses:contract", page: "nav.licenses", label: "permissions.buttons.licenseContract", system: perm("assets.update") },
  { key: "btn:zoom:book", page: "nav.zoomGroup", label: "permissions.buttons.zoomBook" },
  { key: "btn:drivers:create", page: "nav.vehicleDrivers", label: "permissions.buttons.driverCreate", system: (u) => has(u, "vehicle.manage") || has(u, "vehicle.dispatch") },
  { key: "btn:assets:create", page: "nav.assets", label: "permissions.buttons.assetCreate", system: perm("assets.create") },
  { key: "btn:assets:import", page: "nav.assets", label: "permissions.buttons.assetImport", system: perm("assets.create") },
  { key: "btn:assets:edit", page: "nav.assets", label: "permissions.buttons.assetEdit", system: perm("assets.update") },
  { key: "btn:assets:transfer", page: "nav.assets", label: "permissions.buttons.assetTransfer", system: perm("assets.update") },
  { key: "btn:assets:add-missing", page: "nav.assets", label: "permissions.buttons.assetAddMissing", system: perm("assets.create") },
  { key: "btn:assets:link-missing", page: "nav.assets", label: "permissions.buttons.assetLinkMissing", system: perm("assets.update") },
  { key: "btn:assets:export", page: "nav.assets", label: "permissions.buttons.assetExport", system: (u) => has(u, "assets.view_all") || has(u, "assets.create") || has(u, "assets.update") },
  { key: "btn:locations:create", page: "nav.locations", label: "permissions.buttons.locationCreate", system: perm("locations.manage") },
  { key: "btn:vendors:create", page: "nav.vendors", label: "permissions.buttons.vendorCreate", system: perm("vendors.manage") },
  { key: "btn:repair-orders:create", page: "nav.repairOrders", label: "permissions.buttons.repairOrderCreate", system: perm("repair_orders.manage") },
  { key: "btn:repair-orders:return", page: "nav.repairOrders", label: "permissions.buttons.repairOrderReturn", system: perm("repair_orders.manage") },
  { key: "btn:repair-orders:edit", page: "nav.repairOrders", label: "permissions.buttons.repairOrderEdit", system: perm("repair_orders.manage") },
  { key: "btn:repair-orders:cancel", page: "nav.repairOrders", label: "permissions.buttons.repairOrderCancel", system: perm("repair_orders.manage") },
  { key: "btn:users:create", page: "nav.users", label: "permissions.buttons.userCreate", system: perm("users.create") },
  { key: "btn:approval-routes:create", page: "nav.approvalRoutes", label: "permissions.buttons.approvalRouteCreate", system: perm("approval_routes.manage") },
  { key: "btn:audit-logs:export", page: "nav.auditLogs", label: "permissions.buttons.auditExport", system: perm("audit_logs.view") },
];

/**
 * ผู้ใช้ตัวอย่างของแต่ละกลุ่ม (สิทธิ์จากตารางสิทธิ์ของกลุ่ม) — ใช้แสดงช่องที่ระบบไม่อนุญาตในหน้าการมองเห็น
 * กลุ่มที่สร้างเอง = พนักงาน + กลุ่มนั้น
 */
export function sampleUser(a: Audience, config: UiConfig): User {
  const base = { id: 0, name: "", email: "", type: "LOCAL" as const };
  const perms = (x: Audience) => config.role_permissions[x] ?? [];
  const role = (ROLES as readonly string[]).includes(a) ? (a as User["role"]) : "viewer";
  const groups = role === a ? [a] : ["viewer", a];
  return { ...base, role, groups, permissions: [...new Set(groups.flatMap(perms))], can_approve: role !== "viewer" };
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
