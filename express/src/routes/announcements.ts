import { Router, type Request, type Response } from "express";
import { exec, first, insert, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, int, validate, type Rule } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { processPhoto } from "../services/photos.js";
import { deleteStored, randomString, readStored, storeUploadIn, writeStored } from "../services/ticket-files.js";

/**
 * ประกาศข่าวสาร (แสดงที่หน้าภาพรวม) — เหมือน AnnouncementController ของ Laravel
 *   GET    /announcements/public       (ไม่ต้อง login) ประกาศที่แสดงอยู่ ≤ 5 รายการ — ไม่มีข้อมูลไฟล์
 *   GET    /announcements/feed         (login) เหมือน public + รูปหน้าปก + เอกสารแนบ — หน้าภาพรวมใช้อันนี้
 *   GET    /announcements/past         (login) ประกาศที่ผ่านไปแล้ว (เปิดอยู่ + เลยวันสิ้นสุด) ล่าสุดก่อน ≤ PAST_MAX รายการ + รูปหน้าปก + เอกสารแนบ
 *   GET    /announcements              ทั้งหมด (announcements.manage)
 *   GET    /announcements/{id}/files/{fileId}  ผู้จัดการ = ทุกไฟล์, คนอื่น = เฉพาะประกาศที่แสดงอยู่ / ผ่านไปแล้ว
 *   POST   /announcements              JSON หรือ multipart: title, body, level, is_active, starts_on, ends_on, sort_order, repeat_*, cover, files[]
 *   PUT|PATCH /announcements/{id}      เหมือน POST + remove_cover, remove_file_ids[]
 *   DELETE /announcements/{id}
 *
 * การแสดง: ปิด = ไม่แสดง, นอกช่วงวันที่ = ไม่แสดง, ในช่วงแล้วถ้าตั้งทำซ้ำ = แสดงเฉพาะวันที่ตรงเงื่อนไข (repeat none = ทุกวันในช่วงเหมือนเดิม)
 */
export const announcementRoutes = Router();
export const publicAnnouncementRoutes = Router();

const LEVELS = ["info", "warning", "danger"];
const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];
const SHOWN_MAX = 5;
const PAST_MAX = 50;
const COVER = "cover";
const DOCUMENT = "document";
/** รูปหน้าปก ≤ 1MB (หน้าเว็บย่อให้ก่อนส่ง) → WebP ไม่มี metadata / เอกสารตรงกับ DOC_* ของ file-pickers.tsx */
const COVER_RULE: Rule[] = ["image", "mimes:jpg,jpeg,png,webp", "max:1024"];
const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
const FILES_MAX = 10;
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;
/** จำนวนวันสูงสุดของแต่ละเดือน (กุมภาพันธ์นับ 29 — ปีปกติแสดงวันที่ 28) */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Row {
  id: number;
  title: string;
  body: string | null;
  level: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  repeat_mode: string;
  repeat_weekday: number | null;
  repeat_day: number | null;
  repeat_month: number | null;
  created_at: string | null;
  updated_at: string | null;
  cb_id: number | null;
  cb_name: string | null;
}

interface FileRow {
  id: number;
  announcement_id: number;
  kind: string;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

const SELECT = "a.*, u.id AS cb_id, u.name AS cb_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by";

/** ตรงวันทำซ้ำไหม — วันที่เกินจำนวนวันของเดือน (เช่น 31) แสดงวันสุดท้ายของเดือนแทน */
function repeatsOn(r: Row, today: string): boolean {
  if (r.repeat_mode === "none" || r.repeat_mode === "daily") return true;
  const [y, m, d] = today.split("-").map(Number);
  if (r.repeat_mode === "weekly") return Number(r.repeat_weekday) === new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayMatches = Number(r.repeat_day) === d || (d === last && Number(r.repeat_day) > last);
  return r.repeat_mode === "monthly" ? dayMatches : Number(r.repeat_month) === m && dayMatches;
}

/** ประกาศนี้แสดงอยู่วันนี้ไหม (เปิดอยู่ + ในช่วงวันที่ + ตรงวันทำซ้ำ) */
function isShowing(r: Row, today: string): boolean {
  const from = dateOnly(r.starts_on);
  const to = dateOnly(r.ends_on);
  return Boolean(r.is_active) && (!from || from <= today) && (!to || to >= today) && repeatsOn(r, today);
}

/** ประกาศที่ผ่านไปแล้ว: เปิดอยู่ + เลยวันสิ้นสุด — ประกาศที่ปิดไว้ไม่นับ เพราะผู้จัดการตั้งใจซ่อน */
function isPast(r: Row, today: string): boolean {
  const to = dateOnly(r.ends_on);
  return Boolean(r.is_active) && Boolean(to) && to! < today;
}

const publicJson = (r: Row) => ({ id: r.id, title: r.title, body: r.body, level: r.level, starts_on: dateOnly(r.starts_on), ends_on: dateOnly(r.ends_on) });

const filesJson = (r: Row, files: FileRow[]) => {
  const mine = files.filter((f) => Number(f.announcement_id) === Number(r.id));
  const cover = mine.find((f) => f.kind === COVER);
  return {
    cover_url: cover ? `/announcements/${r.id}/files/${cover.id}` : null,
    files: mine.filter((f) => f.kind === DOCUMENT).map((f) => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: Number(f.size), url: `/announcements/${r.id}/files/${f.id}` })),
  };
};

const json = (r: Row, files: FileRow[], today: string) => ({
  ...publicJson(r),
  ...filesJson(r, files),
  repeat_mode: r.repeat_mode,
  repeat_weekday: r.repeat_weekday === null ? null : Number(r.repeat_weekday),
  repeat_day: r.repeat_day === null ? null : Number(r.repeat_day),
  repeat_month: r.repeat_month === null ? null : Number(r.repeat_month),
  is_active: Boolean(r.is_active),
  is_showing: isShowing(r, today),
  sort_order: Number(r.sort_order),
  created_by: r.cb_id ? { id: r.cb_id, name: r.cb_name } : null,
  updated_at: iso(r.updated_at),
});

const filesOf = (ids: number[]) =>
  ids.length ? select<FileRow>("SELECT * FROM announcement_files WHERE announcement_id IN (?) ORDER BY id", [ids]) : Promise.resolve([] as FileRow[]);

/** ประกาศที่แสดงอยู่วันนี้ เรียงตามลำดับ ≤ SHOWN_MAX */
async function showingNow(): Promise<Row[]> {
  const today = localToday();
  const rows = await select<Row>(`SELECT ${SELECT} WHERE a.is_active = true ORDER BY a.sort_order, a.id DESC`);
  return rows.filter((r) => isShowing(r, today)).slice(0, SHOWN_MAX);
}

/** ประกาศที่แสดงอยู่ — ไม่ต้อง login จึงไม่ส่งข้อมูลไฟล์ */
publicAnnouncementRoutes.get("/announcements/public", async (_req, res) => {
  res.json({ data: (await showingNow()).map(publicJson) });
});

const manages = (u: UserRow) => can(u, "announcements.manage");
const manage = (req: Request) => authorize(manages(me(req)));

/** หน้าภาพรวม: ประกาศที่แสดงอยู่ + รูปหน้าปก + เอกสารแนบ */
announcementRoutes.get("/announcements/feed", async (_req, res) => {
  const rows = await showingNow();
  const files = await filesOf(rows.map((r) => Number(r.id)));
  res.json({ data: rows.map((r) => ({ ...publicJson(r), ...filesJson(r, files) })) });
});

/** หน้าภาพรวม: ประกาศที่ผ่านไปแล้ว ให้กดอ่านย้อนหลังได้ */
announcementRoutes.get("/announcements/past", async (_req, res) => {
  const today = localToday();
  const rows = (await select<Row>(`SELECT ${SELECT} WHERE a.is_active = true AND a.ends_on IS NOT NULL ORDER BY a.ends_on DESC, a.id DESC`)).filter((r) => isPast(r, today)).slice(0, PAST_MAX);
  const files = await filesOf(rows.map((r) => Number(r.id)));
  res.json({ data: rows.map((r) => ({ ...publicJson(r), ...filesJson(r, files) })) });
});

announcementRoutes.get("/announcements", async (req, res) => {
  manage(req);
  const rows = await select<Row>(`SELECT ${SELECT} ORDER BY a.sort_order, a.id DESC`);
  const files = await filesOf(rows.map((r) => Number(r.id)));
  const today = localToday();
  res.json({ data: rows.map((r) => json(r, files, today)) });
});

async function findRow(req: Request): Promise<Row> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<Row>(`SELECT ${SELECT} WHERE a.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

announcementRoutes.get("/announcements/:id/files/:fileId", async (req, res) => {
  const row = await findRow(req);
  const today = localToday();
  if (!manages(me(req)) && !isShowing(row, today) && !isPast(row, today)) throw notFound();
  const file = /^\d+$/.test(req.params.fileId) ? await first<FileRow>("SELECT * FROM announcement_files WHERE id = ? AND announcement_id = ?", [Number(req.params.fileId), row.id]) : null;
  if (!file) throw notFound();
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

const validated = (req: Request) =>
  validate(
    req.input,
    {
      title: ["required", "string", "max:200"],
      body: ["nullable", "string", "max:5000"],
      level: ["required", `in:${LEVELS.join(",")}`],
      is_active: ["sometimes", "boolean"],
      starts_on: ["nullable", "date"],
      ends_on: ["nullable", "date"],
      sort_order: ["nullable", "integer", "min:0", "max:999"],
      repeat_mode: ["nullable", `in:${REPEATS.join(",")}`],
      repeat_weekday: ["nullable", "integer", "min:0", "max:6"],
      repeat_day: ["nullable", "integer", "min:1", "max:31"],
      repeat_month: ["nullable", "integer", "min:1", "max:12"],
      cover: ["nullable", ...COVER_RULE],
      remove_cover: ["sometimes", "boolean"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
      remove_file_ids: ["nullable", "array"],
      "remove_file_ids.*": ["integer"],
    },
    {
      locale: req.locale,
      after: ({ data, errors }) => {
        const s = data.starts_on;
        const e = data.ends_on;
        if (typeof s === "string" && typeof e === "string" && s && e && e.slice(0, 10) < s.slice(0, 10) && !errors.has("ends_on")) {
          errors.add("ends_on", trans(req.locale, "eam.announcement.ends_before_starts"));
        }
        const mode = data.repeat_mode;
        const need = (field: string) => {
          if ((data[field] === null || data[field] === undefined || data[field] === "") && !errors.has(field)) errors.add(field, trans(req.locale, "eam.announcement.repeat_required"));
        };
        if (mode === "weekly") need("repeat_weekday");
        if (mode === "monthly" || mode === "yearly") need("repeat_day");
        if (mode === "yearly") {
          need("repeat_month");
          const month = int(data.repeat_month);
          const day = int(data.repeat_day);
          if (month && day && !errors.has("repeat_day") && !errors.has("repeat_month") && day > MONTH_DAYS[month - 1]) errors.add("repeat_day", trans(req.locale, "eam.announcement.repeat_day_invalid"));
        }
      },
    },
  );

function values(data: Record<string, unknown>, input: Record<string, unknown>) {
  const date = (v: unknown) => (typeof v === "string" && v !== "" ? v.slice(0, 10) : null);
  const mode = typeof data.repeat_mode === "string" && data.repeat_mode ? data.repeat_mode : "none";
  return {
    title: String(data.title).trim(),
    body: typeof data.body === "string" && data.body.trim() !== "" ? data.body.trim() : null,
    level: data.level,
    is_active: "is_active" in input ? bool(input.is_active) : true,
    starts_on: date(data.starts_on),
    ends_on: date(data.ends_on),
    sort_order: int(data.sort_order) ?? 0,
    repeat_mode: mode,
    // เก็บเฉพาะค่าที่รูปแบบนั้นใช้
    repeat_weekday: mode === "weekly" ? int(data.repeat_weekday) : null,
    repeat_day: mode === "monthly" || mode === "yearly" ? int(data.repeat_day) : null,
    repeat_month: mode === "yearly" ? int(data.repeat_month) : null,
    updated_at: nowDb(),
  };
}

/** เตรียมรูปหน้าปกก่อนเริ่ม transaction — ไฟล์ที่ไม่ใช่รูปจริง = 422 */
async function coverBuffer(req: Request, data: Record<string, unknown>): Promise<Buffer | null> {
  if (!(data.cover instanceof UploadedFile)) return null;
  try {
    return await processPhoto(data.cover);
  } catch {
    throw ValidationError.withMessages({ cover: trans(req.locale, "eam.meeting.image_invalid", { name: [...data.cover.originalName].slice(0, 80).join("") }) });
  }
}

const uploads = (v: unknown): UploadedFile[] =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : [];

/** เพิ่มรูปหน้าปก/เอกสาร + เอาไฟล์เดิมออก — คืนไฟล์ที่ต้องลบออกจากดิสก์หลัง commit */
async function saveFiles(id: number, data: Record<string, unknown>, cover: Buffer | null, userId: number): Promise<FileRow[]> {
  const now = nowDb();
  const removeIds = Object.values((data.remove_file_ids ?? {}) as Record<string, unknown>).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const dropCover = cover !== null || bool(data.remove_cover);
  const removed = await select<FileRow>(
    `SELECT * FROM announcement_files WHERE announcement_id = ? AND ((kind = 'document' AND id IN (?)) ${dropCover ? "OR kind = 'cover'" : ""})`,
    [id, removeIds.length ? removeIds : [0]],
  );
  if (removed.length) await exec("DELETE FROM announcement_files WHERE id IN (?)", [removed.map((f) => f.id)]);
  if (cover) {
    const path = `announcements/${id}/cover-${randomString(16)}.webp`;
    await writeStored(path, cover);
    await insert("announcement_files", { announcement_id: id, kind: COVER, original_name: "cover.webp", path, mime: "image/webp", size: cover.length, uploaded_by: userId, created_at: now, updated_at: now });
  }
  for (const file of uploads(data.files)) {
    const stored = await storeUploadIn(`announcements/${id}`, file);
    await insert("announcement_files", { announcement_id: id, kind: DOCUMENT, ...stored, uploaded_by: userId, created_at: now, updated_at: now });
  }
  return removed;
}

const respond = async (id: number) => {
  const row = (await first<Row>(`SELECT ${SELECT} WHERE a.id = ?`, [id]))!;
  return json(row, await filesOf([id]), localToday());
};

announcementRoutes.post("/announcements", async (req, res) => {
  manage(req);
  const data = await validated(req);
  const cover = await coverBuffer(req, data);
  const id = await transaction(async () => {
    const newId = await insert("announcements", { ...values(data, req.input), created_by: me(req).id, created_at: nowDb() });
    await saveFiles(newId, data, cover, me(req).id);
    return newId;
  });
  res.status(201).json({ data: await respond(id) });
});

async function updateRow(req: Request, res: Response) {
  const row = await findRow(req);
  manage(req);
  const data = await validated(req);
  const cover = await coverBuffer(req, data);
  const removed = await transaction(async () => {
    await update("announcements", values(data, req.input), "id = ?", [row.id]);
    return saveFiles(Number(row.id), data, cover, me(req).id);
  });
  for (const f of removed) await deleteStored(f.path);
  res.json({ data: await respond(Number(row.id)) });
}
announcementRoutes.put("/announcements/:id", updateRow);
announcementRoutes.patch("/announcements/:id", updateRow);

announcementRoutes.delete("/announcements/:id", async (req, res) => {
  const row = await findRow(req);
  manage(req);
  const files = await filesOf([Number(row.id)]);
  await exec("DELETE FROM announcements WHERE id = ?", [row.id]);
  for (const f of files) await deleteStored(f.path);
  res.status(204).end();
});
