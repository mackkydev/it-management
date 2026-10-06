/**
 * รายการสิทธิ์ (permission catalog) — สิทธิ์จริงของผู้ใช้ = สิทธิ์ของกลุ่มที่สังกัด + เพิ่มรายคน − ถอดรายคน
 * กลุ่ม (audience) = role (admin | manager | viewer) + it_staff / it_head ตาม flag ของผู้ใช้ — ชุดเดียวกับหน้า "สิทธิ์การใช้งาน"
 * defaults = กลุ่มที่ได้สิทธิ์นี้ตอนสร้าง key ครั้งแรก (ตรงกับพฤติกรรมเดิมก่อนมีตารางสิทธิ์ทุกข้อ)
 * Local Admin ผ่านทุกสิทธิ์เสมอ (ถอดรายคนไม่มีผล)
 */
/** it_staff = บทบาท "เจ้าหน้าที่ IT" และ flag is_it_staff ใช้กลุ่มสิทธิ์เดียวกัน */
export const AUDIENCES = ["admin", "division_manager", "manager", "viewer", "it_staff", "it_head"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface PermissionDef {
  key: string;
  group: "tickets" | "it_data" | "assets" | "users" | "system";
  name_th: string;
  name_en: string;
  defaults: Audience[];
}

const IT: Audience[] = ["admin", "it_staff", "it_head"];
const MANAGERS: Audience[] = ["admin", "manager"];
const MANAGERS_IT: Audience[] = ["admin", "manager", "it_staff", "it_head"];

export const PERMISSIONS: PermissionDef[] = [
  // ใบแจ้งงาน — การแจ้งงาน/ดูใบของตัวเอง/อนุมัติตามสาย ทุกคนทำได้เสมอ (ไม่ต้องมีสิทธิ์)
  { key: "it_tickets.queue", group: "tickets", name_th: "เห็นคิวงาน IT และใบงานที่อนุมัติแล้ว", name_en: "See the IT queue and approved tickets", defaults: IT },
  { key: "it_tickets.accept", group: "tickets", name_th: "รับงานที่ยังไม่มีผู้รับ", name_en: "Accept unassigned tickets", defaults: ["it_staff"] },
  { key: "it_tickets.manage_all", group: "tickets", name_th: "รับงาน/บันทึกความคืบหน้าและผลแทนผู้อื่น", name_en: "Accept / update tickets on behalf of others", defaults: ["admin", "it_head"] },
  { key: "it_tickets.close", group: "tickets", name_th: "ตรวจรับและปิดงาน / ส่งกลับแก้ไข", name_en: "Review and close / return tickets", defaults: ["admin", "it_head"] },
  { key: "tickets.view_all", group: "tickets", name_th: "ดูใบแจ้งงานทั้งหมด (รวมที่ยังไม่อนุมัติ)", name_en: "View every ticket (including pending approval)", defaults: ["admin"] },
  { key: "tickets.approve_any", group: "tickets", name_th: "อนุมัติแทนผู้อนุมัติทุกสาย", name_en: "Approve on behalf of any approver", defaults: ["admin"] },
  { key: "kpi.use", group: "tickets", name_th: "บันทึก/ดู KPI ของตัวเอง", name_en: "Record / view own KPI", defaults: IT },
  { key: "kpi.view_all", group: "tickets", name_th: "ดู KPI ของทุกคน", name_en: "View everyone's KPI", defaults: ["admin", "it_head"] },
  { key: "kpi.edit_all", group: "tickets", name_th: "แก้ไข/ลบ KPI ของผู้อื่น", name_en: "Edit / delete others' KPI", defaults: ["admin"] },

  // ข้อมูลฝ่าย IT
  { key: "vault.use", group: "it_data", name_th: "คลังบัญชี/รหัสผ่าน", name_en: "Credential vault", defaults: IT },
  { key: "contracts.manage", group: "it_data", name_th: "สัญญา vendor", name_en: "Vendor contracts", defaults: IT },
  { key: "announcements.manage", group: "it_data", name_th: "จัดการประกาศหน้า login", name_en: "Manage login announcements", defaults: IT },

  // สินทรัพย์
  // ไม่มีสิทธิ์นี้ (และไม่มี assets.manage) = เห็นเฉพาะสินทรัพย์ที่ตัวเองถือครอง (ผู้ถือครอง หรือชื่อผู้ใช้งานตรงกับชื่อตัวเอง)
  { key: "assets.view_all", group: "assets", name_th: "ดูสินทรัพย์ทั้งหมด (ไม่มีสิทธิ์นี้ = เห็นเฉพาะที่ตัวเองถือครอง)", name_en: "View all assets (otherwise only the user's own)", defaults: MANAGERS_IT },
  { key: "assets.manage", group: "assets", name_th: "เพิ่ม/แก้ไขสินทรัพย์ สถานที่ ไฟล์ และการโอนย้าย", name_en: "Create / edit assets, locations, files and movements", defaults: MANAGERS },
  { key: "assets.delete", group: "assets", name_th: "ลบสินทรัพย์", name_en: "Delete assets", defaults: ["admin"] },
  { key: "locations.delete", group: "assets", name_th: "ลบสถานที่", name_en: "Delete locations", defaults: ["admin"] },
  { key: "assets.license_key", group: "assets", name_th: "เปิดดู license key", name_en: "Reveal license keys", defaults: MANAGERS_IT },
  { key: "licenses.install", group: "assets", name_th: "บันทึกการติดตั้ง license", name_en: "Record license installations", defaults: MANAGERS_IT },

  // ผู้ใช้ / ข้อมูลหลัก
  { key: "users.view", group: "users", name_th: "เปิดหน้ารายชื่อผู้ใช้", name_en: "Open the user list", defaults: MANAGERS },
  { key: "users.search", group: "users", name_th: "ค้นหาผู้ใช้ (เลือกผู้ถือครอง/ผู้ใช้งาน)", name_en: "Search users (pickers)", defaults: MANAGERS_IT },
  { key: "users.manage", group: "users", name_th: "เพิ่ม/แก้ไข/ลบผู้ใช้", name_en: "Create / edit / delete users", defaults: ["admin"] },
  { key: "branches.manage", group: "users", name_th: "จัดการสาขา", name_en: "Manage branches", defaults: ["admin"] },
  { key: "org.manage", group: "users", name_th: "จัดการแผนกและฝ่าย", name_en: "Manage departments and divisions", defaults: ["admin"] },
  // ลายเซ็น: จัดการของตัวเอง (ตั้งต้นทุกกลุ่ม) / ใช้ลายเซ็นของผู้อื่นในเอกสาร
  { key: "signature.manage_own", group: "users", name_th: "อัปโหลด/วาด/ลบลายเซ็นของตัวเอง", name_en: "Upload / draw / delete own signature", defaults: [...AUDIENCES] },
  { key: "signature.use", group: "users", name_th: "ใช้ลายเซ็นของผู้อื่นในเอกสาร", name_en: "Use other users' signatures in documents", defaults: ["admin"] },

  // ตั้งค่าระบบ
  { key: "settings.manage", group: "system", name_th: "ตั้งค่าระบบ (แจ้งเตือน, ประเภทงาน, การมองเห็นเมนู)", name_en: "System settings (notifications, ticket types, menu visibility)", defaults: ["admin"] },
  { key: "approval_routes.manage", group: "system", name_th: "จัดการสายอนุมัติ", name_en: "Manage approval routes", defaults: ["admin"] },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
