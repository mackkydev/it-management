/**
 * รายการสิทธิ์ (permission catalog) — สิทธิ์จริงของผู้ใช้ = สิทธิ์ของทุกกลุ่มที่สังกัด + เพิ่มรายคน − ถอดรายคน
 * กลุ่ม = กลุ่มตามตำแหน่ง (users.role) + กลุ่มที่มอบเพิ่มรายคน (user_groups) — ดู services/permissions.ts
 * ผู้ดูแลระบบ (super_admin) ผ่านทุกสิทธิ์เสมอ (ถอดรายคนไม่มีผล) — การเชื่อมต่อ API แก้ได้เฉพาะ super_admin บัญชี LOCAL (ไม่ใช่ permission key)
 *
 * module + action = ตำแหน่งในตารางสิทธิ์ (แถว = ระบบงาน, คอลัมน์ = ดู / เพิ่ม / แก้ไข / ลบ / อนุมัติ / อื่นๆ)
 * defaults = กลุ่มที่ได้สิทธิ์นี้ตอนสร้าง key ครั้งแรก
 * from = key เดิมที่แยกออกมา — ตอนสร้าง key ใหม่ คัดลอกการกำหนดสิทธิ์ของ key เดิม (กลุ่ม + รายคน) แทน defaults ไม่ให้ใครเสียสิทธิ์
 * locked = สงวนไว้ให้ผู้ดูแลระบบ: มอบ/ถอดได้เฉพาะ super_admin (ผู้ดูแลระบบ (admin)ไม่ได้ตั้งแต่ต้น แต่ super_admin ติ๊กให้กลุ่ม/รายคนได้)
 */

/** กลุ่มตามตำแหน่ง (system) — ใช้กับ defaults (super_admin ผ่านทุกสิทธิ์ ไม่ต้องระบุ) — กลุ่มฝ่าย IT เดิมถูกยุบเข้า admin / super_admin แล้ว */
export type Audience = "admin" | "division_manager" | "manager" | "viewer";

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
  { key: "calendar", group: "users", name_th: "ปฏิทินและวันหยุด", name_en: "Calendar and holidays" },
  { key: "leave", group: "users", name_th: "การลา", name_en: "Leave" },
  { key: "meeting", group: "users", name_th: "ห้องประชุม", name_en: "Meeting rooms" },
  { key: "vehicle", group: "users", name_th: "จองรถ", name_en: "Vehicle booking" },
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

const IT: Audience[] = ["admin"];
const MANAGERS: Audience[] = ["admin", "manager"];
const MANAGERS_IT: Audience[] = ["admin", "manager"];

type Def = Omit<PermissionDef, "group">;
const DEFS: Def[] = [
  // ใบแจ้งงาน — การแจ้งงาน/ดูใบของตัวเอง/อนุมัติตามสาย ทุกคนทำได้เสมอ (ไม่ต้องมีสิทธิ์)
  { key: "tickets.view_all", module: "tickets", action: "view", name_th: "ดูใบแจ้งงานทั้งหมด (รวมที่ยังไม่อนุมัติ)", name_en: "View every ticket (including pending approval)", defaults: ["admin"] },
  { key: "tickets.approve_any", module: "tickets", action: "approve", name_th: "อนุมัติแทนผู้อนุมัติทุกสาย", name_en: "Approve on behalf of any approver", defaults: ["admin"] },
  // ผู้จัดการขึ้นไปอนุมัติใบแจ้งงานของตัวเองได้ (ทุกขั้นของสาย) — ปุ่มอนุมัติในหน้าใบงาน ไม่นับเป็นงานรออนุมัติ (ตัวเลขเมนู)
  { key: "tickets.approve_own", module: "tickets", action: "approve", name_th: "อนุมัติใบแจ้งงานของตัวเอง", name_en: "Approve own tickets", defaults: ["division_manager", "manager", "admin"] },
  { key: "it_tickets.queue", module: "it_jobs", action: "view", name_th: "เห็นคิวงาน IT และใบงานที่อนุมัติแล้ว", name_en: "See the IT queue and approved tickets", defaults: IT },
  { key: "it_tickets.manage_all", module: "it_jobs", action: "update", name_th: "รับงาน/บันทึกความคืบหน้าและผลแทนผู้อื่น", name_en: "Accept / update tickets on behalf of others", defaults: ["admin"] },
  { key: "it_tickets.close", module: "it_jobs", action: "approve", name_th: "ตรวจรับและปิดงาน / ส่งกลับแก้ไข", name_en: "Review and close / return tickets", defaults: ["admin"] },
  { key: "it_tickets.accept", module: "it_jobs", action: "other", name_th: "รับงานที่ยังไม่มีผู้รับ", name_en: "Accept unassigned tickets", defaults: ["admin"] },
  // คิวงาน IT: รับงานที่ผู้แจ้งเลือกคนอื่นไว้ (เช่น คนนั้นลา) — ผู้รับเดิมไม่มีงานค้างในเมนู/KPI อีก
  { key: "it_tickets.take_over", module: "it_jobs", action: "other", name_th: "รับงานแทนเจ้าหน้าที่ที่ถูกเลือก (คิวงาน IT)", name_en: "Take over tickets assigned to other staff (IT queue)", defaults: IT },
  { key: "kpi.view_all", module: "kpi", action: "view", name_th: "ดู KPI ของทุกคน", name_en: "View everyone's KPI", defaults: [] }, // หัวหน้า IT = ผู้ดูแลระบบสูงสุด (ผ่านทุกสิทธิ์) — ผู้ดูแลระบบเห็นแค่ของตัวเอง
  { key: "kpi.use", module: "kpi", action: "create", name_th: "บันทึก/ดู KPI ของตัวเอง", name_en: "Record / view own KPI", defaults: IT },
  { key: "kpi.edit_all", module: "kpi", action: "update", name_th: "แก้ไข/ลบ KPI ของผู้อื่น", name_en: "Edit / delete others' KPI", defaults: [] },

  // ข้อมูลฝ่าย IT
  { key: "vault.view", module: "vault", action: "view", name_th: "ดูคลังบัญชี และเปิดดูรหัสผ่าน", name_en: "View the vault and reveal passwords", defaults: IT, from: "vault.use" },
  { key: "vault.create", module: "vault", action: "create", name_th: "เพิ่มบัญชี/รหัสผ่าน", name_en: "Add credentials", defaults: IT, from: "vault.use" },
  { key: "vault.update", module: "vault", action: "update", name_th: "แก้ไขบัญชี/รหัสผ่าน", name_en: "Edit credentials", defaults: IT, from: "vault.use" },
  { key: "vault.delete", module: "vault", action: "delete", name_th: "ลบบัญชี/รหัสผ่าน", name_en: "Delete credentials", defaults: IT, from: "vault.use" },
  { key: "contracts.view", module: "contracts", action: "view", name_th: "ดูสัญญา vendor", name_en: "View vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.create", module: "contracts", action: "create", name_th: "เพิ่มสัญญา vendor", name_en: "Add vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.update", module: "contracts", action: "update", name_th: "แก้ไขสัญญา vendor", name_en: "Edit vendor contracts", defaults: IT, from: "contracts.manage" },
  { key: "contracts.delete", module: "contracts", action: "delete", name_th: "ลบสัญญา vendor", name_en: "Delete vendor contracts", defaults: IT, from: "contracts.manage" },
  // ผู้ที่แก้สัญญาได้อยู่แล้ว ได้สิทธิ์จัดการหมวดหมู่ตั้งแต่แรก (from)
  { key: "contracts.categories", module: "contracts", action: "manage", name_th: "จัดการหมวดหมู่สัญญา (ข้อมูลหลัก)", name_en: "Manage contract categories (master data)", defaults: IT, from: "contracts.update" },
  { key: "announcements.manage", module: "announcements", action: "manage", name_th: "จัดการประกาศหน้า login", name_en: "Manage login announcements", defaults: IT },

  // สินทรัพย์ — ไม่มี assets.view_all (และไม่มี assets.create/update) = เห็นเฉพาะสินทรัพย์ที่ตัวเองถือครอง
  { key: "assets.view_all", module: "assets", action: "view", name_th: "ดูสินทรัพย์ทั้งหมด (ไม่มีสิทธิ์นี้ = เห็นเฉพาะที่ตัวเองถือครอง)", name_en: "View all assets (otherwise only the user's own)", defaults: MANAGERS_IT },
  { key: "assets.create", module: "assets", action: "create", name_th: "เพิ่มสินทรัพย์ / นำเข้า Excel", name_en: "Add assets / import Excel", defaults: MANAGERS, from: "assets.manage" },
  { key: "assets.update", module: "assets", action: "update", name_th: "แก้ไขสินทรัพย์ ไฟล์ และการโอนย้าย", name_en: "Edit assets, files and movements", defaults: MANAGERS, from: "assets.manage" },
  { key: "assets.delete", module: "assets", action: "delete", name_th: "ลบสินทรัพย์", name_en: "Delete assets", defaults: ["admin"] },
  { key: "movements.view", module: "assets", action: "other", name_th: "ดูรายงานประวัติการโอนย้าย (ทุกเครื่อง)", name_en: "View the movement report (all assets)", defaults: MANAGERS_IT, from: "assets.view_all" },
  { key: "assets.license_key", module: "assets", action: "other", name_th: "เปิดดู license key", name_en: "Reveal license keys", defaults: MANAGERS_IT },
  { key: "locations.view", module: "locations", action: "view", name_th: "เปิดหน้ารายการสถานที่ (ช่องเลือกสถานที่ในฟอร์มใช้ได้ทุกคน)", name_en: "Open the location list (location pickers work for everyone)", defaults: ["admin", "division_manager", "manager", "viewer"] },
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
  { key: "signature.manage_own", module: "signature", action: "manage", name_th: "อัปโหลด/วาด/ลบลายเซ็นของตัวเอง", name_en: "Upload / draw / delete own signature", defaults: ["admin", "division_manager", "manager", "viewer"] },
  { key: "signature.use", module: "signature", action: "other", name_th: "ใช้ลายเซ็นของผู้อื่นในเอกสาร", name_en: "Use other users' signatures in documents", defaults: ["admin"] },

  // ตั้งค่าระบบ
  { key: "settings.manage", module: "settings", action: "manage", name_th: "ตั้งค่าระบบ (แจ้งเตือน, ประเภทงาน, โลโก้, ลำดับเมนู)", name_en: "System settings (notifications, ticket types, logo, menu order)", defaults: ["admin"] },
  // หน้า ข้อมูล Drop Down: Computer Type / ยี่ห้อ / หมวดหมู่คลังบัญชี — ผู้ที่ตั้งค่าระบบได้อยู่แล้วได้ตั้งแต่แรก (from)
  { key: "dropdowns.manage", module: "settings", action: "other", name_th: "จัดการข้อมูล Drop Down (Computer Type, ยี่ห้อ, หมวดหมู่คลังบัญชี)", name_en: "Manage drop-down data (computer type, brand, vault category)", defaults: ["admin"], from: "settings.manage" },
  { key: "approval_routes.manage", module: "approval_routes", action: "manage", name_th: "จัดการสายอนุมัติ", name_en: "Manage approval routes", defaults: ["admin"] },
  { key: "audit_logs.view", module: "audit", action: "view", name_th: "ดูบันทึกการเปลี่ยนแปลง (audit log)", name_en: "View the audit log", defaults: ["admin"] },
  { key: "access.assign", module: "access", action: "other", name_th: "มอบตำแหน่ง/กลุ่ม/สิทธิ์ให้ผู้ใช้ (เฉพาะสิทธิ์ที่ตัวเองมี)", name_en: "Assign roles / groups / permissions to users (only ones held)", defaults: ["admin"] },
  { key: "access.manage", module: "access", action: "manage", name_th: "กำหนดสิทธิ์ของกลุ่ม / สร้างกลุ่ม / การมองเห็นเมนู / วันหมดอายุของสิทธิ์", name_en: "Edit group permissions / groups / menu visibility / permission expiry", defaults: [], locked: true },
  // PIN กลาง: ผู้ดูแลระบบ (admin)แก้ได้ — ทุกครั้งแจ้งเตือนผู้ดูแลระบบสูงสุด + ผู้ดูแลระบบทุกคน (routes/it-data.ts)
  { key: "secrets.pin_manage", module: "security", action: "update", name_th: "ตั้ง/เปลี่ยน PIN กลางสำหรับเปิดดูรหัสผ่าน / License key (แจ้งเตือนผู้ดูแลระบบทุกคน)", name_en: "Set / change the shared PIN for viewing secrets (notifies all admins)", defaults: ["admin"] },
  // ปฏิทิน: ทุกคนดูปฏิทิน (ตามขอบเขตของกลุ่ม) / ขอลา / สร้างกิจกรรมของตัวเองได้เสมอ — ผู้อนุมัติลา = หัวหน้าที่ผู้ลาระบุ
  { key: "leave.view_all", module: "leave", action: "view", name_th: "ดูใบลาของทุกคน / ส่งออกรายงานการลา", name_en: "View everyone's leave / export the leave report", defaults: ["admin"] },
  { key: "leave.approve_any", module: "leave", action: "approve", name_th: "อนุมัติใบลาแทนผู้อนุมัติที่ระบุ", name_en: "Approve leave on behalf of the chosen approver", defaults: ["admin"] },
  { key: "holidays.manage", module: "calendar", action: "manage", name_th: "จัดการวันหยุดบริษัท / ตั้งค่าการลา / กิจกรรมทั้งบริษัท", name_en: "Manage company holidays / leave settings / company-wide events", defaults: ["admin"] },
  // ห้องประชุม: ทุกคนดูปฏิทินห้อง / จอง / แก้-ยกเลิก-ลบการจองของตัวเองได้เสมอ
  { key: "meeting.manage_any", module: "meeting", action: "update", name_th: "แก้ไข / ยกเลิก / ลบการจองห้องประชุมของผู้อื่น", name_en: "Edit / cancel / delete other people's room bookings", defaults: ["admin"] },
  { key: "meeting.rooms", module: "meeting", action: "manage", name_th: "จัดการห้องประชุม (รายละเอียด / ที่นั่ง / รูป) และตัวเลือกประเภทการใช้งาน / อุปกรณ์", name_en: "Manage meeting rooms (details / seats / photos) and the usage-type / equipment options", defaults: ["admin"] },
  // จองรถ: ทุกคนดูปฏิทินรถ / จอง (ไม่ระบุรถได้) / แก้-ยกเลิก-ลบ / บันทึกเลขไมล์ของการจองตัวเองได้เสมอ
  { key: "vehicle.dispatch", module: "vehicle", action: "update", name_th: "จัดคิวรถ: เลือกรถให้การจอง และแก้ไข / ยกเลิก / ลบการจองของผู้อื่น", name_en: "Dispatch: assign vehicles and edit / cancel / delete other people's bookings", defaults: ["admin"] },
  { key: "vehicle.manage", module: "vehicle", action: "manage", name_th: "จัดการรถ (รายละเอียด / ที่นั่ง / รูป / เลขไมล์) และตัวเลือกประเภทการใช้งาน / รายการเพิ่มเติม", name_en: "Manage vehicles (details / seats / photos / mileage) and the usage-type / extra options", defaults: ["admin"] },
];

const GROUP_OF = Object.fromEntries(MODULES.map((m) => [m.key, m.group])) as Record<ModuleKey, PermissionDef["group"]>;
export const PERMISSIONS: PermissionDef[] = DEFS.map((d) => ({ ...d, group: GROUP_OF[d.module] }));

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
/** สิทธิ์ที่สงวนไว้ให้ผู้ดูแลระบบ (super_admin) มอบ/ถอด */
export const LOCKED_KEYS = new Set(PERMISSIONS.filter((p) => p.locked).map((p) => p.key));
