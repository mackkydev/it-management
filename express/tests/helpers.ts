import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { first, insert } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import { makeHash } from "../src/lib/validator.js";
import type { UserRow } from "../src/models/user.js";

/** helper แทน factory + Sanctum::actingAs ของเทสต์ Laravel */
export const app = createApp();

let seq = 0;
const next = () => ++seq;

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
export function day(n: number): string {
  const d = new Date();
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
