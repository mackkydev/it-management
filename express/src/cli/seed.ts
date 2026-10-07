import { config } from "../config.js";
import { closePool, exec, first, insert, transaction, update } from "../db.js";
import { nowDb } from "../lib/time.js";
import { makeHash } from "../lib/validator.js";
import { ensurePermissions } from "../services/permissions.js";

/**
 * ข้อมูลตั้งต้นของ IT-SYSTEM — รันซ้ำได้ (npm run db:seed / npx prisma db seed)
 * เทียบเท่า DatabaseSeeder + ItSystemSeeder ของ Laravel (ไม่รวมข้อมูลตัวอย่างผู้ใช้/สินทรัพย์จำนวนมาก)
 *   - สาขาตามแบบฟอร์ม "ใบแจ้งดำเนินงาน IT"
 *   - admin@example.com + ผู้ใช้ตัวอย่างสายบังคับบัญชา / ฝ่าย IT (รหัสผ่าน = SEED_ADMIN_PASSWORD)
 * ผู้ใช้ที่มีอยู่แล้วจะไม่ถูกเปลี่ยนรหัสผ่าน
 */
const BRANCHES: Array<[string, string]> = [
  ["BKK", "กรุงเทพ"],
  ["SRB", "สระบุรี"],
  ["SKT", "สุโขทัย"],
  ["BRM", "บุรีรัมย์"],
  ["UBN", "อุบลราชธานี"],
  ["KKN", "ขอนแก่น"],
  ["LPN", "ลำพูน"],
  ["CBI", "ชลบุรี"],
  ["PBT", "พระพุทธบาท"],
  ["NMA", "นครราชสีมา"],
];

const password = process.env.SEED_ADMIN_PASSWORD?.replace(/^"(.*)"$/, "$1");
if (!password) {
  console.error("SEED_ADMIN_PASSWORD is required (password for the seeded accounts)");
  process.exit(1);
}

async function upsertBranch(code: string, name: string, sortOrder: number): Promise<number> {
  const now = nowDb();
  const existing = await first<{ id: number }>("SELECT id FROM branches WHERE code = ?", [code]);
  if (existing) {
    // withTrashed()->updateOrCreate — กู้สาขาที่ถูกลบกลับมาด้วย
    await update("branches", { name, sort_order: sortOrder, is_active: true, deleted_at: null, updated_at: now }, "id = ?", [existing.id]);
    return existing.id;
  }
  return insert("branches", { code, name, sort_order: sortOrder, is_active: true, created_at: now, updated_at: now });
}

async function upsertUser(email: string, attrs: Record<string, unknown>): Promise<number> {
  const now = nowDb();
  const existing = await first<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    await update("users", { ...attrs, updated_at: now }, "id = ?", [existing.id]);
    return existing.id;
  }
  return insert("users", {
    email,
    password: makeHash(password!, config.bcryptRounds),
    email_verified_at: now,
    is_active: true,
    is_it_staff: false,
    is_it_head: false,
    created_at: now,
    updated_at: now,
    ...attrs,
  });
}

try {
  await transaction(async () => {
    const ids: Record<string, number> = {};
    for (const [i, [code, name]] of BRANCHES.entries()) ids[code] = await upsertBranch(code, name, (i + 1) * 10);

    const itDivision = { department: "IT", division: "เทคโนโลยีสารสนเทศ" };
    await upsertUser("admin@example.com", { name: "System Admin", role: "super_admin", branch_id: ids.BKK, ...itDivision });
    await upsertUser("viewer@example.com", { name: "Read Only User", role: "viewer" });
    const itHead = await upsertUser("it.head@example.com", {
      name: "IT Manager", role: "manager", branch_id: ids.BKK, ...itDivision, is_it_head: true, is_it_staff: true,
    });
    await upsertUser("it.staff@example.com", {
      name: "IT Support", role: "manager", branch_id: ids.BKK, ...itDivision, is_it_staff: true, supervisor_id: itHead,
    });
    const chief = await upsertUser("chief@example.com", { name: "Sales Manager", role: "viewer", branch_id: ids.KKN, department: "ขาย", division: "ขาย" });
    await upsertUser("staff@example.com", {
      name: "Sales Staff", role: "viewer", branch_id: ids.KKN, department: "ขาย", division: "ขาย", supervisor_id: chief,
    });
  });
  await ensurePermissions(); // กลุ่ม + key สิทธิ์ + สิทธิ์ตั้งต้นของกลุ่ม (ไม่แตะที่ปรับไว้แล้ว)
  // ผู้ใช้ตัวอย่างฝ่าย IT: สิทธิ์มาจากกลุ่มฝ่าย IT (ช่อง จนท.IT / หัวหน้า IT = หน้าที่ในใบแจ้งงานเท่านั้น) — ข้ามถ้าลบกลุ่มไปแล้ว
  for (const [group, flag] of [["it_staff", "is_it_staff"], ["it_head", "is_it_head"]] as const) {
    await exec(
      `INSERT IGNORE INTO user_groups (user_id, group_key, created_at)
       SELECT u.id, g."key", ? FROM users u JOIN permission_groups g ON g."key" = ? WHERE u.${flag} = true AND u.email LIKE '%@example.com'`,
      [nowDb(), group],
    );
  }
  console.log(`Seeded ${BRANCHES.length} branches and 6 users (existing passwords unchanged).`);
} finally {
  await closePool();
}
