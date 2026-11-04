import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, transaction, update } from "../db.js";
import { me } from "../http.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, custom, regex, validate, type Rule } from "../lib/validator.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";

/**
 * ข้อมูลหลัก → Vendor (vendors.manage) — ฟอร์มส่งซ่อมเลือกผ่าน GET /repair-orders/form-options
 * เพิ่ม/แก้รับ JSON หรือ multipart (files[] เอกสารบริษัท, remove_file_ids[] เอาไฟล์เดิมออก)
 * ลบ = soft delete เฉพาะที่ยังไม่มีรายการส่งซ่อม — มีแล้วให้ปิดใช้งาน
 */
export const vendorRoutes = Router();

/** ตรงกับ DOC_MAX_BYTES / DOC_ACCEPT ของหน้าเว็บ (file-pickers.tsx) — ไฟล์ละ ≤ 5MB ครั้งละไม่เกิน 10 ไฟล์ */
const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
const FILES_MAX = 10;
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;
/** เปิดเป็นลิงก์ในหน้าเว็บ — รับเฉพาะ http/https (กัน javascript:) */
const WEB_URL = /^https?:\/\/\S+$/i;

interface VendorRow {
  id: number;
  name: string;
  tax_id: string | null;
  address: string;
  contact_name: string;
  contact_phone: string;
  vendor_type: string;
  map_url: string | null;
  is_active: boolean | number;
  repairs_count: number | string;
}

interface FileRow {
  id: number;
  vendor_id: number;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}

const SELECT = "v.*, (SELECT COUNT(*) FROM repair_orders r WHERE r.vendor_id = v.id) AS repairs_count";

const fileJson = (f: FileRow) => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: Number(f.size), url: `/vendors/${f.vendor_id}/files/${f.id}` });

const json = (v: VendorRow, files: FileRow[]) => ({
  id: Number(v.id),
  name: v.name,
  tax_id: v.tax_id,
  address: v.address,
  contact_name: v.contact_name,
  contact_phone: v.contact_phone,
  vendor_type: v.vendor_type,
  map_url: v.map_url,
  is_active: Boolean(v.is_active),
  repairs_count: Number(v.repairs_count),
  files: files.map(fileJson),
});

const filesOf = (vendorIds: number[]) =>
  vendorIds.length ? select<FileRow>("SELECT * FROM vendor_files WHERE vendor_id IN (?) ORDER BY id", [vendorIds]) : Promise.resolve([] as FileRow[]);

const load = async (id: number) => {
  const row = Number.isNaN(id) ? null : await first<VendorRow>(`SELECT ${SELECT} FROM vendors v WHERE v.id = ? AND v.deleted_at IS NULL`, [id]);
  if (!row) throw notFound();
  return row;
};
const routeId = (req: Request) => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN);
const find = (req: Request) => load(routeId(req));
const withFiles = async (v: VendorRow) => json(v, await filesOf([Number(v.id)]));

const uploads = (v: unknown): UploadedFile[] =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile) : [];

async function saveFiles(vendorId: number, files: UploadedFile[], userId: number) {
  const now = nowDb();
  for (const file of files) {
    const stored = await storeUploadIn(`vendors/${vendorId}`, file);
    await insert("vendor_files", { vendor_id: vendorId, ...stored, uploaded_by: userId, created_at: now, updated_at: now });
  }
}

const input = (req: Request, current: VendorRow | null) =>
  validate(
    req.input,
    {
      name: [
        "required",
        "string",
        "max:255",
        custom(async (v) => {
          const name = String(v).trim();
          return (await scalar(`SELECT 1 FROM vendors WHERE name = ? AND deleted_at IS NULL${current ? " AND id <> ?" : ""}`, current ? [name, current.id] : [name])) === null;
        }, trans(req.locale, "eam.org.duplicate")),
      ],
      tax_id: ["nullable", "string", "max:20"],
      address: ["required", "string", "max:2000"],
      contact_name: ["required", "string", "max:255"],
      contact_phone: ["required", "string", "max:50"],
      vendor_type: ["required", "string", "max:100"],
      map_url: ["nullable", "string", "max:1000", regex(WEB_URL)],
      is_active: ["sometimes", "boolean"],
      files: ["nullable", "array", `max:${FILES_MAX}`],
      "files.*": FILE_RULE,
      remove_file_ids: ["nullable", "array"],
      "remove_file_ids.*": ["integer"],
    },
    { locale: req.locale, messages: { "map_url.regex": trans(req.locale, "eam.vendor.map_url_invalid") } },
  );

const columns = (d: Record<string, unknown>) => ({
  name: String(d.name).trim(),
  tax_id: String(d.tax_id ?? "").trim() || null,
  address: String(d.address).trim(),
  contact_name: String(d.contact_name).trim(),
  contact_phone: String(d.contact_phone).trim(),
  vendor_type: String(d.vendor_type).trim(),
  map_url: String(d.map_url ?? "").trim() || null,
  ...("is_active" in d ? { is_active: bool(d.is_active) } : {}),
});

vendorRoutes.get("/vendors", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const rows = await select<VendorRow>(`SELECT ${SELECT} FROM vendors v WHERE v.deleted_at IS NULL ORDER BY v.is_active DESC, v.name`);
  const files = await filesOf(rows.map((r) => Number(r.id)));
  res.json({ data: rows.map((r) => json(r, files.filter((f) => Number(f.vendor_id) === Number(r.id)))) });
});

vendorRoutes.get("/vendors/:id", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  res.json({ data: await withFiles(await find(req)) });
});

/** GET /vendors/{id}/files/{fileId}[?download=1] — pdf/รูป/ข้อความเปิดดูในเบราว์เซอร์ได้ ไฟล์อื่นดาวน์โหลด */
vendorRoutes.get("/vendors/:id/files/:fileId", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const vendor = await find(req);
  const file = /^\d+$/.test(req.params.fileId) ? await first<FileRow>("SELECT * FROM vendor_files WHERE id = ? AND vendor_id = ?", [Number(req.params.fileId), vendor.id]) : null;
  if (!file) throw notFound();
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

vendorRoutes.post("/vendors", async (req, res) => {
  const u = me(req);
  authorize(can(u, "vendors.manage"));
  const data = await input(req, null);
  const id = await transaction(async () => {
    const now = nowDb();
    const vendorId = await insert("vendors", { ...columns(data), created_at: now, updated_at: now });
    await saveFiles(vendorId, uploads(data.files), u.id);
    return vendorId;
  });
  const result = await withFiles(await load(id));
  await audit(req, { action: "vendor.created", subjectType: "vendor", subjectId: id, after: result });
  res.status(201).json({ data: result });
});

vendorRoutes.put("/vendors/:id", async (req, res) => {
  const u = me(req);
  authorize(can(u, "vendors.manage"));
  const current = await find(req);
  const data = await input(req, current);
  const before = await withFiles(current);
  const removeIds = Object.values((data.remove_file_ids ?? {}) as Record<string, unknown>).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let removed: FileRow[] = [];
  await transaction(async () => {
    await update("vendors", { ...columns(data), updated_at: nowDb() }, "id = ?", [current.id]);
    removed = removeIds.length ? await select<FileRow>("SELECT * FROM vendor_files WHERE vendor_id = ? AND id IN (?)", [current.id, removeIds]) : [];
    if (removed.length) await exec("DELETE FROM vendor_files WHERE id IN (?)", [removed.map((f) => f.id)]);
    await saveFiles(Number(current.id), uploads(data.files), u.id);
  });
  for (const f of removed) await deleteStored(f.path);
  const result = await withFiles(await load(Number(current.id)));
  await audit(req, { action: "vendor.updated", subjectType: "vendor", subjectId: current.id, before, after: result });
  res.json({ data: result });
});

vendorRoutes.delete("/vendors/:id", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const current = await find(req);
  if (Number(current.repairs_count) > 0) throw ValidationError.withMessages({ vendor: trans(req.locale, "eam.vendor.in_use", { count: Number(current.repairs_count) }) });
  const now = nowDb();
  await update("vendors", { deleted_at: now, updated_at: now }, "id = ?", [current.id]);
  await audit(req, { action: "vendor.deleted", subjectType: "vendor", subjectId: current.id, before: await withFiles(current) });
  res.status(204).end();
});
