import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { exec, first, insert } from "../src/db.js";
import { localToday, nowDb } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import { makeHash } from "../src/lib/validator.js";
import type { UserRow } from "../src/models/user.js";

/** helper แทน factory + Sanctum::actingAs ของเทสต์ Laravel */
export const app = createApp();

let seq = 0;
const next = () => ++seq;

/** สิทธิ์ของกลุ่มฝ่าย IT เดิม (ก่อน migration 20261013090000) — ใช้เป็นกลุ่มที่สร้างเองในเทสต์ */
const IT_STAFF_KEYS = [
  "it_tickets.queue", "it_tickets.accept", "kpi.use", "vault.view", "vault.create", "vault.update", "vault.delete",
  "contracts.view", "contracts.create", "contracts.update", "contracts.delete", "announcements.manage",
  "assets.view_all", "movements.view", "assets.license_key", "licenses.install", "users.search", "signature.manage_own",
];
const IT_HEAD_KEYS = [...IT_STAFF_KEYS.filter((k) => k !== "it_tickets.accept"), "it_tickets.manage_all", "it_tickets.close", "kpi.view_all"];

export async function ensureTestItGroups(): Promise<void> {
  const now = nowDb();
  for (const [key, name, keys, order] of [["it_staff", "เจ้าหน้าที่ IT", IT_STAFF_KEYS, 10], ["it_head", "หัวหน้า IT", IT_HEAD_KEYS, 11]] as const) {
    await exec(
      "INSERT IGNORE INTO permission_groups (\"key\", name_th, name_en, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, false, ?, ?, ?)",
      [key, name, key, order, now, now],
    );
    await exec(
      "INSERT IGNORE INTO role_permissions (role, permission_id, created_at) SELECT ?, id, ? FROM permissions WHERE \"key\" IN (?)",
      [key, now, [...keys]],
    );
  }
}

export async function makeUser(attrs: Partial<UserRow> & { password?: string } = {}): Promise<UserRow> {
  const n = next();
  const now = nowDb();
  const { password = "password", ...rest } = attrs;
  const id = await insert("users", {
    name: `User ${n}`,
    email: `user${n}@example.com`,
    role: "viewer",
    is_active: true,
    is_it_staff: false,
    is_it_head: false,
    password: makeHash(password, config.bcryptRounds),
    created_at: now,
    updated_at: now,
    ...rest,
  });
  // ระบบจริงไม่มีกลุ่มฝ่าย IT แล้ว (ยุบเป็นตำแหน่ง admin / super_admin) — เทสต์จำลองเจ้าหน้าที่ IT สิทธิ์จำกัดด้วย "กลุ่มที่สร้างเอง" สิทธิ์ชุดเดิม
  if (rest.is_it_staff || rest.is_it_head) await ensureTestItGroups();
  if (rest.is_it_staff) await exec("INSERT IGNORE INTO user_groups (user_id, group_key, created_at) VALUES (?, 'it_staff', ?)", [id, now]);
  if (rest.is_it_head) await exec("INSERT IGNORE INTO user_groups (user_id, group_key, created_at) VALUES (?, 'it_head', ?)", [id, now]);
  return (await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
}

export async function tokenFor(user: UserRow, name = "test"): Promise<string> {
  return (await createToken(user.id, name, null)).plainText;
}

/** supertest พร้อม Bearer token ของผู้ใช้ (เหมือน Sanctum::actingAs) */
export async function as(user: UserRow, locale?: string) {
  const token = await tokenFor(user);
  const withHeaders = (r: request.Test) => {
    r.set("Accept", "application/json").set("Authorization", `Bearer ${token}`);
    if (locale) r.set("Accept-Language", locale);
    return r;
  };
  const agent = request(app);
  return {
    get: (url: string) => withHeaders(agent.get(url)),
    post: (url: string) => withHeaders(agent.post(url)),
    put: (url: string) => withHeaders(agent.put(url)),
    patch: (url: string) => withHeaders(agent.patch(url)),
    delete: (url: string) => withHeaders(agent.delete(url)),
  };
}

export const guest = () => request(app);

export async function makeLocation(attrs: Record<string, unknown> = {}): Promise<number> {
  const n = next();
  const now = nowDb();
  return insert("locations", { code: `LOC-${n}`, name: `Room ${n}`, type: "room", is_active: true, created_at: now, updated_at: now, ...attrs });
}

export async function makeAsset(attrs: Record<string, unknown> = {}): Promise<{ id: number; uuid: string }> {
  const n = next();
  const now = nowDb();
  const uuid = randomUUID();
  const id = await insert("assets", {
    uuid, asset_tag: `TAG-${n}`, name: `Asset ${n}`, category: "IT", status: "active", created_at: now, updated_at: now, ...attrs,
  });
  return { id, uuid };
}

export async function makeBranch(attrs: Record<string, unknown> = {}): Promise<number> {
  const n = next();
  const now = nowDb();
  return insert("branches", { code: `BR${n}`, name: `สาขา ${n}`, sort_order: 0, is_active: true, created_at: now, updated_at: now, ...attrs });
}

export async function makeContract(attrs: Record<string, unknown>): Promise<number> {
  const now = nowDb();
  return insert("contracts", { notify_enabled: true, created_at: now, updated_at: now, ...attrs });
}

/** วันที่ (UTC) ห่างจากวันนี้ n วัน "YYYY-MM-DD" */
/** วันนี้ ± n วัน ตามเวลาไทย (เหมือนที่ API ใช้) — ใช้ UTC จะเพี้ยนช่วงเที่ยงคืนถึง 07:00 */
export function day(n: number): string {
  return localDay(n);
}

/** วันที่ตาม timezone ผู้ใช้ (EAM_LOCAL_TIMEZONE) ห่างจากวันนี้ n วัน — ใช้กับ rule "ห้ามเป็นวันในอนาคต" */
export function localDay(n: number): string {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------- ไฟล์ทดสอบ (แทน UploadedFile::fake()) */

/** PNG 1x1 สำหรับลายเซ็น */
export const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** ไฟล์รูปขนาด kb กิโลไบต์ (ส่วนหัวเป็นรูปจริงตามชนิด) */
export function fakeImage(kb = 10, type: "png" | "jpg" = "jpg"): Buffer {
  const head = type === "png" ? PNG_HEAD : JPG_HEAD;
  return Buffer.concat([head, Buffer.alloc(Math.max(0, kb * 1024 - head.length), 1)]);
}

export function fakePdf(kb = 10): Buffer {
  const head = Buffer.from("%PDF-1.4\n");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, kb * 1024 - head.length), 0x20)]);
}

/** รูปจริง (decode ได้) สำหรับเทสต์ลายเซ็น: พื้นโปร่งใส (png) หรือขาว (jpg) + ลายเส้นสี่เหลี่ยมกลางภาพ */
export async function realImage(width = 1200, height = 400, type: "png" | "jpg" = "png", mark: { w: number; h: number } | null = { w: 300, h: 80 }): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const background = type === "png" ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 };
  let img = sharp({ create: { width, height, channels: 4, background } });
  if (mark) {
    const stroke = await sharp({ create: { width: mark.w, height: mark.h, channels: 4, background: { r: 20, g: 30, b: 120, alpha: 1 } } }).png().toBuffer();
    img = img.composite([{ input: stroke, left: Math.floor((width - mark.w) / 2), top: Math.floor((height - mark.h) / 2) }]);
  }
  return type === "png" ? img.png().toBuffer() : img.jpeg().toBuffer();
}
