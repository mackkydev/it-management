/**
 * รายการสิทธิ์ (permission catalog) — สิทธิ์จริงของผู้ใช้ = สิทธิ์ของทุกกลุ่มที่สังกัด + เพิ่มรายคน − ถอดรายคน
 * กลุ่ม = กลุ่มตามตำแหน่ง (users.role) + กลุ่มที่มอบเพิ่มรายคน (user_groups) — ดู services/permissions.ts
 * ผู้ดูแลระบบ (super_admin) ผ่านทุกสิทธิ์เสมอ (ถอดรายคนไม่มีผล) — การเชื่อมต่อ API แก้ได้เฉพาะ super_admin บัญชี LOCAL (ไม่ใช่ permission key)
 *
 * module + action = ตำแหน่งในตารางสิทธิ์ (แถว = ระบบงาน, คอลัมน์ = ดู / เพิ่ม / แก้ไข / ลบ / อนุมัติ / อื่นๆ)
 * defaults = กลุ่มที่ได้สิทธิ์นี้ตอนสร้าง key ครั้งแรก
 * from = key เดิมที่แยกออกมา — ตอนสร้าง key ใหม่ คัดลอกการกำหนดสิทธิ์ของ key เดิม (กลุ่ม + รายคน) แทน defaults ไม่ให้ใครเสียสิทธิ์
 * locked = สงวนไว้ให้ผู้ดูแลระบบ: มอบ/ถอดได้เฉพาะ super_admin (ผู้ดูแลระบบรองไม่ได้ตั้งแต่ต้น แต่ super_admin ติ๊กให้กลุ่ม/รายคนได้)
 */

/** กลุ่มตามตำแหน่ง (system) + กลุ่มฝ่าย IT เดิม (สร้างจาก migration — แก้/ลบได้) — ใช้กับ defaults */
export type Audience = "admin" | "division_manager" | "manager" | "viewer" | "it_staff" | "it_head";

export const ACTIONS = ["view", "create", "update", "delete", "approve", "manage", "other"] as const;
export type PermissionAction = (typeof ACTIONS)[number];

/** ระบบงาน (แถวของตาราง) เรียงตามลำดับที่แสดง — group = หมวดเดิม (tickets | it_data | assets | users | system) */
export const MODULES = [
  { key: "tickets", group: "tickets", name_th: "ใบแจ้งงาน", name_en: "Tickets" },
  { key: "it_jobs", group: "tickets", name_th: "งานฝ่าย IT (คิวงาน)", name_en: "IT jobs (queue)" },
  { key: "kpi", group: "tickets", name_th: "KPI ฝ่าย IT", name_en: "IT KPI" },
  { key: "vault", group: "it_data", name_th: "คลังบัญชี/รหัสผ่าน", name_en: "Credential vault" },
  { key: "contracts", group: "it_data", name_th: "สัญญา vendor", name_en: "Vendor contracts" },
  { key: "announcements", group: "it_data", name_th: "ประกาศหน้า login", name_en: "Login announcements" },
  { key: "assets", group: "assets", name_th: "สินทรัพย์", name_en: "Assets" },
  { key: "locations", group: "assets", name_th: "สถานที่", name_en: "Locations" },
  { key: "licenses", group: "assets", name_th: "การติดตั้ง License", name_en: "License installations" },
  { key: "users", group: "users", name_th: "ผู้ใช้", name_en: "Users" },
  { key: "branches", group: "users", name_th: "สาขา", name_en: "Branches" },
  { key: "org", group: "users", name_th: "แผนกและฝ่าย", name_en: "Departments and divisions" },
  { key: "signature", group: "users", name_th: "ลายเซ็น", name_en: "Signatures" },
  { key: "settings", group: "system", name_th: "ตั้งค่าระบบ", name_en: "System settings" },
  { key: "approval_routes", group: "system", name_th: "สายอนุมัติ", name_en: "Approval routes" },
  { key: "audit", group: "system", name_th: "บันทึกการเปลี่ยนแปลง", name_en: "Audit log" },
  { key: "access", group: "system", name_th: "สิทธิ์การใช้งาน", name_en: "Access control" },
  { key: "security", group: "system", name_th: "ความปลอดภัย", name_en: "Security" },
] as const;
export type ModuleKey = (typeof MODULES)[number]["key"];

export interface PermissionDef {
  key: string;
  /** หมวด (คอลัมน์ permissions.group เดิม) — ตามระบบงาน */
  group: "tickets" | "it_data" | "assets" | "users" | "system";
  module: ModuleKey;
  action: PermissionAction;
  name_th: string;
  name_en: string;
  defaults: Audience[];
  from?: string;
  locked?: boolean;
}

const IT: Audience[] = ["admin", "it_staff", "it_head"];
const MANAGERS: Audience[] = ["admin", "manager"];
const MANAGERS_IT: Audience[] = ["admin", "manager", "it_staff", "it_head"];

type Def = Omit<PermissionDef, "group">;
const DEFS: Def[] = [
  // ใบแจ้งงาน — การแจ้งงาน/ดูใบของตัวเอง/อนุมัติตามสาย ทุกคนทำได้เสมอ (ไม่ต้องมีสิทธิ์)
  { key: "tickets.view_all", module: "tickets", action: "view", name_th: "ดูใบแจ้งงานทั้งหมด (รวมที่ยังไม่อนุมัติ)", name_en: "View every ticket (including pending approval)", defaults: ["admin"] },
  { key: "tickets.approve_any", module: "tickets", action: "approve", name_th: "อนุมัติแทนผู้อนุมัติทุกสาย", name_en: "Approve on behalf of any approver", defaults: ["admin"] },
  { key: "it_tickets.queue", module: "it_jobs", action: "view", name_th: "เห็นคิวงาน IT และใบงานที่อนุมัติแล้ว", name_en: "See the IT queue and approved tickets", defaults: IT },
  { key: "it_tickets.manage_all", module: "it_jobs", action: "update", name_th: "รับงาน/บันทึกความคืบหน้าและผลแทนผู้อื่น", name_en: "Accept / update tickets on behalf of others", defaults: ["admin", "it_head"] },
  { key: "it_tickets.close", module: "it_jobs", action: "approve", name_th: "ตรวจรับและปิดงาน / ส่งกลับแก้ไข", name_en: "Review and close / return tickets", defaults: ["admin", "it_head"] },
  { key: "it_tickets.accept", module: "it_jobs", action: "other", name_th: "รับงานที่ยังไม่มีผู้รับ", name_en: "Accept unassigned tickets", defaults: ["admin", "it_staff"] },
  { key: "kpi.view_all", module: "kpi", action: "view", name_th: "ดู KPI ของทุกคน", name_en: "View everyone's KPI", defaults: ["admin", "it_head"] },
  { key: "kpi.use", module: "kpi", action: "create", name_th: "บันทึก/ดู KPI ของตัวเอง", name_en: "Record / view own KPI", defaults: IT },
  { key: "kpi.edit_all", module: "kpi", action: "update", name_th: "แก้ไข/ลบ KPI ของผู้อื่น", name_en: "Edit / delete others' KPI", defaults: ["admin"] },

  // ข้อมูลฝ่าย IT
  { key: "vault.view", module: "vault", action: "view", name_th: "ดูคลังบัญชี และเปิดดูรหัสผ่าน", name_en: "View the vault and reveal passwords", defaults: IT, from: "vault.use" },
  { key: "vault.create", module: "vault", action: "create", name_th: "เพิ่มบัญชี/รหัสผ่าน", name_en: "Add credentials", defaults: IT, from: "vault.use" },
  { key: "vault.update", module: "vault", action: "update", name_th: "แก้ไขบัญชี/รหัสผ่าน", name_en: "Edit credentials", defaults: IT, from: "vault.use" },
  { key: "vault.delete", module: "vault", action: "delete", name_th: "ลบบัญชี/รหัสผ่าน", name_en: "Delete credentials", defaults: IT, from: "vault.use" },
  { key: "contracts.view", module: "contracts", action: "view", name_th: "ดูสัญญา vendor", name_en: "View vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.create", module: "contracts", action: "create", name_th: "เพิ่มสัญญา vendor", name_en: "Add vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.update", module: "contracts", action: "update", name_th: "แก้ไขสัญญา vendor", name_en: "Edit vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.delete", module: "contracts", action: "delete", name_th: "ลบสัญญา vendor", name_en: "Delete vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "announcements.manage", module: "announcements", action: "manage", name_th: "จัดการประกาศหน้า login", name_en: "Manage login announcements", defaults: IT },

  // สินทรัพย์ — ไม่มี assets.view_all (และไม่มี assets.create/update) = เห็นเฉพาะสินทรัพย์ที่ตัวเองถือครอง
  { key: "assets.view_all", module: "assets", action: "view", name_th: "ดูสินทรัพย์ทั้งหมด (ไม่มีสิทธิ์นี้ = เห็นเฉพาะที่ตัวเองถือครอง)", name_en: "View all assets (otherwise only the user's own)", defaults: MANAGERS_IT },
  { key: "assets.create", module: "assets", action: "create", name_th: "เพิ่มสินทรัพย์ / นำเข้า Excel", name_en: "Add assets / import Excel", defaults: MANAGERS, from: "assets.manage" },
  { key: "assets.update", module: "assets", action: "update", name_th: "แก้ไขสินทรัพย์ ไฟล์ และการโอนย้าย", name_en: "Edit assets, files and movements", defaults: MANAGERS, from: "assets.manage" },
  { key: "assets.delete", module: "assets", action: "delete", name_th: "ลบสินทรัพย์", name_en: "Delete assets", defaults: ["admin"] },
  { key: "assets.license_key", module: "assets", action: "other", name_th: "เปิดดู license key", name_en: "Reveal license keys", defaults: MANAGERS_IT },
  { key: "locations.manage", module: "locations", action: "manage", name_th: "เพิ่ม/แก้ไขสถานที่", name_en: "Add / edit locations", defaults: MANAGERS, from: "assets.manage" },
  { key: "locations.delete", module: "locations", action: "delete", name_th: "ลบสถานที่", name_en: "Delete locations", defaults: ["admin"] },
  { key: "licenses.install", module: "licenses", action: "manage", name_th: "บันทึก/ถอนการติดตั้ง license", name_en: "Record / remove license installations", defaults: MANAGERS_IT },

  // ผู้ใช้ / ข้อมูลหลัก
  { key: "users.view", module: "users", action: "view", name_th: "เปิดหน้ารายชื่อผู้ใช้", name_en: "Open the user list", defaults: MANAGERS },
  { key: "users.create", module: "users", action: "create", name_th: "เพิ่มผู้ใช้", name_en: "Add users", defaults: ["admin"], from: "users.manage" },
  { key: "users.update", module: "users", action: "update", name_th: "แก้ไขผู้ใช้ (ข้อมูล / ปิดใช้งาน / รีเซ็ตรหัสผ่าน)", name_en: "Edit users (details / deactivate / reset password)", defaults: ["admin"], from: "users.manage" },
  { key: "users.delete", module: "users", action: "delete", name_th: "ลบผู้ใช้", name_en: "Delete users", defaults: ["admin"], from: "users.manage" },
  { key: "users.search", module: "users", action: "other", name_th: "ค้นหาผู้ใช้ (เลือกผู้ถือครอง/ผู้ใช้งาน)", name_en: "Search users (pickers)", defaults: MANAGERS_IT },
  { key: "branches.manage", module: "branches", action: "manage", name_th: "จัดการสาขา", name_en: "Manage branches", defaults: ["admin"] },
  { key: "org.manage", module: "org", action: "manage", name_th: "จัดการแผนกและฝ่าย", name_en: "Manage departments and divisions", defaults: ["admin"] },
  // ลายเซ็น: จัดการของตัวเอง (ตั้งต้นทุกกลุ่ม) / ใช้ลายเซ็นของผู้อื่นในเอกสาร
  { key: "signature.manage_own", module: "signature", action: "manage", name_th: "อัปโหลด/วาด/ลบลายเซ็นของตัวเอง", name_en: "Upload / draw / delete own signature", defaults: ["admin", "division_manager", "manager", "viewer", "it_staff", "it_head"] },
  { key: "signature.use", module: "signature", action: "other", name_th: "ใช้ลายเซ็นของผู้อื่นในเอกสาร", name_en: "Use other users' signatures in documents", defaults: ["admin"] },

  // ตั้งค่าระบบ
  { key: "settings.manage", module: "settings", action: "manage", name_th: "ตั้งค่าระบบ (แจ้งเตือน, ประเภทงาน, โลโก้, ลำดับเมนู)", name_en: "System settings (notifications, ticket types, logo, menu order)", defaults: ["admin"] },
  { key: "approval_routes.manage", module: "approval_routes", action: "manage", name_th: "จัดการสายอนุมัติ", name_en: "Manage approval routes", defaults: ["admin"] },
  { key: "audit_logs.view", module: "audit", action: "view", name_th: "ดูบันทึกการเปลี่ยนแปลง (audit log)", name_en: "View the audit log", defaults: ["admin"] },
  { key: "access.assign", module: "access", action: "other", name_th: "มอบตำแหน่ง/กลุ่ม/สิทธิ์ให้ผู้ใช้ (เฉพาะสิทธิ์ที่ตัวเองมี)", name_en: "Assign roles / groups / permissions to users (only ones held)", defaults: ["admin"] },
  { key: "access.manage", module: "access", action: "manage", name_th: "กำหนดสิทธิ์ของกลุ่ม / สร้างกลุ่ม / การมองเห็นเมนู / วันหมดอายุของสิทธิ์", name_en: "Edit group permissions / groups / menu visibility / permission expiry", defaults: [], locked: true },
  // PIN กลาง: ผู้ดูแลระบบรองแก้ได้ — ทุกครั้งแจ้งเตือนผู้ดูแลระบบ + ผู้ดูแลระบบรองทุกคน (routes/it-data.ts)
  { key: "secrets.pin_manage", module: "security", action: "update", name_th: "ตั้ง/เปลี่ยน PIN กลางสำหรับเปิดดูรหัสผ่าน / License key (แจ้งเตือนผู้ดูแลระบบทุกคน)", name_en: "Set / change the shared PIN for viewing secrets (notifies all admins)", defaults: ["admin"] },
];

const GROUP_OF = Object.fromEntries(MODULES.map((m) => [m.key, m.group])) as Record<ModuleKey, PermissionDef["group"]>;
export const PERMISSIONS: PermissionDef[] = DEFS.map((d) => ({ ...d, group: GROUP_OF[d.module] }));

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
/** สิทธิ์ที่สงวนไว้ให้ผู้ดูแลระบบ (super_admin) มอบ/ถอด */
export const LOCKED_KEYS = new Set(PERMISSIONS.filter((p) => p.locked).map((p) => p.key));
