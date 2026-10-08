import { insert, select } from "../db.js";
import { nowDb } from "../lib/time.js";
import { forgetLaravelCache } from "./settings.js";

/** รหัสสถานที่ถัดไปแบบอัตโนมัติ LOC-0001, LOC-0002, … (นับรวมที่ถูกลบ เพราะรหัสห้ามซ้ำ) */
export async function nextLocationCode(): Promise<string> {
  const rows = await select<{ code: string }>("SELECT code FROM locations WHERE code LIKE 'LOC-%'");
  const max = rows.reduce((m, r) => Math.max(m, /^LOC-(\d+)$/.test(r.code) ? Number(r.code.slice(4)) : 0), 0);
  return `LOC-${String(max + 1).padStart(4, "0")}`;
}

/** เพิ่มสถานที่ด่วน (ชื่ออย่างเดียว) — รหัสอัตโนมัติ, ประเภท "ห้อง" (แก้ได้ที่หน้าสถานที่) */
export async function quickCreateLocation(name: string): Promise<{ id: number; code: string; name: string }> {
  const code = await nextLocationCode();
  const now = nowDb();
  const id = await insert("locations", { code, name, type: "room", is_active: true, created_at: now, updated_at: now });
  await forgetLaravelCache("locations:active");
  return { id, code, name };
}
