import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { exec, first, insert, isUuid, select, transaction } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { addDays, dateOnly, fromDbDate, iso, localToday, nowDb, toDbDate } from "../lib/time.js";
import { exists, int, regex, unique, validate, type ErrorBag, type Rules } from "../lib/validator.js";
import { limits } from "../lib/rate-limit.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import {
  activeCount, addLicenseFile, BILLINGS, daysLeft, expiringLicenseWhere, fileJson, ICON_KIND, isLicenseExpiring, LICENSE_STATUSES, licenseTerms, licenseTermValues,
  loadFiles, revealKey, SOFTWARE_TYPES, touchLicense, viewsLicenses, type LicenseFileRow, type LicenseRow,
} from "../services/licenses.js";
import { processIcon } from "../services/photos.js";
import { assertCanReveal, notifyReveal } from "../services/secret-guard.js";
import { deleteStored, randomString, readStored, storeUploadIn, writeStored } from "../services/ticket-files.js";

/**
 * License ซอฟต์แวร์ (ตาราง licenses แยกจากสินทรัพย์) — ใช้สิทธิ์ชุดเดิม: assets.create / update / delete, assets.license_key, licenses.install
 *   GET    /licenses                     รายการ + จำนวนที่ใช้/คงเหลือ + S/N + เครื่องที่ติดตั้ง (เมนู ซอฟต์แวร์ License)
 *   POST   /licenses                     { license_no?, name, brand, model, serial_number, status, branch_id, location_id, purchase_*, notes, license: {...} }
 *   GET/PUT/DELETE /licenses/{uuid}      DELETE = soft delete
 *   POST   /licenses/{uuid}/license-key  ดู key (ยืนยันตัวตนซ้ำตามการตั้งค่า + บันทึกทุกครั้ง)
 *   POST   /licenses/{uuid}/files, GET/DELETE /licenses/{uuid}/files/{id}, PUT/GET/DELETE /licenses/{uuid}/icon
 *   POST   /licenses/{uuid}/renew, /licenses/{uuid}/cancel   จัดการสัญญา
 */
export const licenseRoutes = Router();

const TAG = /^[A-Za-z0-9\-_/]+$/;
const FIELDS = ["name", "brand", "model", "serial_number", "status", "location_id", "branch_id", "purchase_date", "purchase_cost", "notes"] as const;
const FILE_RULE = ["file", "mimes:pdf,txt,xml,zip,jpg,jpeg,png,webp,doc,docx,xls,xlsx", "max:10240"]; // ≤ 10MB
/** พรีวิวในเบราว์เซอร์ได้ (ที่เหลือดาวน์โหลด) */
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

async function findLicense(uuid: unknown): Promise<LicenseRow> {
  const row = typeof uuid === "string" && isUuid(uuid) ? await first<LicenseRow>("SELECT * FROM licenses WHERE uuid = ? AND deleted_at IS NULL", [uuid]) : null;
  if (!row) throw notFound();
  return row;
}

async function resource(l: LicenseRow) {
  const location = l.location_id ? await first<{ id: number; code: string; name: string }>("SELECT id, code, name FROM locations WHERE id = ? AND deleted_at IS NULL", [l.location_id]) : null;
  const branch = l.branch_id ? await first<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = ?", [l.branch_id]) : null;
  const files = await loadFiles(l.id);
  const used = await activeCount(l.id);
  return {
    id: l.uuid,
    license_no: l.license_no,
    name: l.name,
    brand: l.brand,
    model: l.model,
    serial_number: l.serial_number,
    status: l.status,
    location,
    branch,
    purchase_date: dateOnly(l.purchase_date),
    purchase_cost: l.purchase_cost,
    notes: l.notes,
    license: licenseTerms(l, await isLicenseExpiring(l.id)),
    license_usage: { seats: l.seats, used, available: l.seats === null ? null : Math.max(0, l.seats - used) },
    files: files.filter((f) => f.kind !== ICON_KIND).map((f) => fileJson(l.uuid, f)),
    icon_id: files.find((f) => f.kind === ICON_KIND)?.id ?? null,
    created_at: iso(l.created_at),
    updated_at: iso(l.updated_at),
  };
}

function rules(current?: LicenseRow, hasTerms = true): Rules {
  const r = (x: Rules[string]) => (current ? ["sometimes", ...x] : x);
  return {
    // เลขที่ทรัพย์สิน ไม่บังคับ — กรอกแล้วต้องไม่ซ้ำ
    license_no: ["sometimes", "nullable", "string", "max:50", regex(TAG), unique("licenses", "license_no", current?.id)],
    name: r(["required", "string", "max:255"]),
    brand: r(["nullable", "string", "max:100"]),
    model: r(["nullable", "string", "max:100"]),
    serial_number: r(["nullable", "string", "max:100"]),
    status: ["sometimes", `in:${LICENSE_STATUSES.join(",")}`],
    location_id: r(["nullable", "integer", exists("locations", "id", "deleted_at IS NULL")]),
    branch_id: r(["nullable", "integer", exists("branches", "id", "deleted_at IS NULL")]),
    purchase_date: r(["nullable", "date", `before_or_equal:${localToday()}`]),
    purchase_cost: r(["nullable", "numeric", "min:0", "max:9999999999999.99"]),
    notes: r(["nullable", "string", "max:5000"]),
    ...(hasTerms
      ? {
          license: ["required", "array"],
          "license.billing": ["required", `in:${BILLINGS.join(",")}`],
          "license.start_date": ["required", "date"],
          "license.expires_at": ["required_if:license.billing,yearly,custom", "nullable", "date"],
          "license.seats": ["nullable", "integer", "min:1", "max:1000000"],
          "license.vendor": ["nullable", "string", "max:255"],
          "license.license_key": ["nullable", "string", "max:5000"],
          "license.clear_license_key": ["sometimes", "boolean"],
          "license.notify_days_before": ["nullable", "integer", "min:1", "max:365"],
          "license.software_type": ["nullable", `in:${SOFTWARE_TYPES.join(",")}`],
        }
      : {}),
  };
}

const after = (req: Request, currentId?: number) => async ({ data, errors }: { data: Record<string, unknown>; errors: ErrorBag }) => {
  const l = data.license as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object") return;
  // จำนวน seat ต้องไม่น้อยกว่าการติดตั้งที่ใช้งานอยู่
  if (currentId && !errors.has("license.seats") && l.seats !== null && l.seats !== undefined && l.seats !== "") {
    const used = await activeCount(currentId);
    if (Number(l.seats) < used) errors.add("license.seats", trans(req.locale, "eam.license.seats_below_used", { used }));
  }
  if (l.billing === "perpetual" || errors.has("license.expires_at") || errors.has("license.start_date")) return;
  if (typeof l.start_date === "string" && typeof l.expires_at === "string" && l.expires_at.slice(0, 10) < l.start_date.slice(0, 10)) {
    errors.add("license.expires_at", trans(req.locale, "eam.license.expires_before_start"));
  }
};

const messages = (req: Request) => ({
  "license_no.regex": trans(req.locale, "eam.validation.asset_tag_regex"),
  "license_no.unique": trans(req.locale, "eam.validation.asset_tag_unique"),
  "purchase_date.before_or_equal": trans(req.locale, "eam.validation.purchase_date_future"),
});

/** ค่าจาก input → คอลัมน์ */
function columns(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("license_no" in data) out.license_no = typeof data.license_no === "string" && data.license_no.trim() ? data.license_no.trim() : null;
  for (const k of FIELDS) {
    if (!(k in data)) continue;
    const v = data[k];
    if (v === null || v === undefined) out[k] = v;
    else if (k === "location_id" || k === "branch_id") out[k] = int(v);
    else if (k === "purchase_date") out[k] = String(v).slice(0, 10);
    else if (k === "purchase_cost") out[k] = Number(v).toFixed(2);
    else out[k] = v;
  }
  return out;
}

licenseRoutes.get("/licenses", async (req, res) => {
  authorize(viewsLicenses(me(req)));
  const exp = await expiringLicenseWhere();
  const rows = await select<LicenseRow & { used: number; files: number; icon_id: number | null; expiring: number }>(
    `SELECT li.*, (${exp.sql}) AS expiring,
            (SELECT COUNT(*) FROM license_installations i WHERE i.license_id = li.id AND i.uninstalled_at IS NULL) AS used,
            (SELECT COUNT(*) FROM license_files f WHERE f.license_id = li.id AND f.kind <> ?) AS files,
            (SELECT MAX(f.id) FROM license_files f WHERE f.license_id = li.id AND f.kind = ?) AS icon_id
       FROM licenses li
      WHERE li.deleted_at IS NULL
      ORDER BY li.name, li.id`,
    [...exp.params, ICON_KIND, ICON_KIND],
  );
  // เครื่องที่ติดตั้งอยู่ของแต่ละ license (หน้ารวม License ชื่อเดียวกัน)
  const installs = rows.length
    ? await select<{ license_id: number; device_name: string | null; uuid: string | null; asset_tag: string | null; name: string | null }>(
        `SELECT i.license_id, i.device_name, d.uuid, d.asset_tag, d.name
           FROM license_installations i LEFT JOIN assets d ON d.id = i.device_asset_id AND d.deleted_at IS NULL
          WHERE i.uninstalled_at IS NULL AND i.license_id IN (?)
          ORDER BY i.id`,
        [rows.map((r) => r.id)],
      )
    : [];
  res.json({
    data: rows.map((r) => {
      const used = Number(r.used);
      return {
        id: r.uuid,
        license_no: r.license_no,
        serial_number: r.serial_number,
        name: r.name,
        devices: installs
          .filter((i) => Number(i.license_id) === Number(r.id))
          .map((i) => ({ id: i.uuid, asset_tag: i.asset_tag, name: i.name ?? i.device_name })),
        seats: r.seats,
        used,
        available: r.seats === null ? null : Math.max(0, r.seats - used),
        billing: r.billing,
        software_type: r.software_type,
        cancelled_at: iso(r.cancelled_at),
        expiring: Boolean(Number(r.expiring)),
        vendor: r.vendor,
        status: r.status,
        files_count: Number(r.files),
        icon_id: r.icon_id === null ? null : Number(r.icon_id),
        expires_at: dateOnly(r.expires_at),
        days_left: daysLeft(dateOnly(r.expires_at)),
      };
    }),
  });
});

licenseRoutes.post("/licenses", async (req, res) => {
  authorize(can(me(req), "assets.create"));
  const data = await validate(req.input, rules(), { locale: req.locale, messages: messages(req), after: after(req) });
  const u = me(req);
  const now = nowDb();
  const id = await insert("licenses", {
    uuid: randomUUID(),
    status: "active",
    ...columns(data),
    ...licenseTermValues(data.license as Record<string, unknown>, null),
    created_by: u.id,
    updated_by: u.id,
    created_at: now,
    updated_at: now,
  });
  const row = (await first<LicenseRow>("SELECT * FROM licenses WHERE id = ?", [id]))!;
  res.status(201).json({ data: await resource(row) });
});

licenseRoutes.get("/licenses/:uuid", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(viewsLicenses(me(req)));
  res.json({ data: await resource(row) });
});

async function updateLicense(req: Request, res: import("express").Response) {
  const current = await findLicense(req.params.uuid);
  authorize(can(me(req), "assets.update"));
  const hasTerms = "license" in req.input;
  const data = await validate(req.input, rules(current, hasTerms), { locale: req.locale, messages: messages(req), after: after(req, current.id) });
  await transaction(async () => {
    const locked = (await first<LicenseRow>("SELECT * FROM licenses WHERE id = ? FOR UPDATE", [current.id]))!;
    await touchLicense(current.id, {
      ...columns(data),
      ...(hasTerms ? licenseTermValues(data.license as Record<string, unknown>, locked) : {}),
      updated_by: me(req).id,
    });
  });
  res.json({ data: await resource((await first<LicenseRow>("SELECT * FROM licenses WHERE id = ?", [current.id]))!) });
}
licenseRoutes.put("/licenses/:uuid", updateLicense);
licenseRoutes.patch("/licenses/:uuid", updateLicense);

/** Soft delete — เก็บประวัติไว้เพื่อการตรวจสอบ */
licenseRoutes.delete("/licenses/:uuid", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(can(me(req), "assets.delete"));
  await touchLicense(row.id, { deleted_at: nowDb() });
  res.status(204).end();
});

/** ดู license key (ถอดรหัส) — ตรวจ IP / ยืนยันตัวตนซ้ำ (ถ้าเปิดใช้) + บันทึก audit ทุกครั้ง + แจ้งผู้รับที่ตั้งไว้ */
licenseRoutes.post("/licenses/:uuid/license-key", limits.reveal, async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(can(me(req), "assets.license_key"));
  await assertCanReveal(req);
  const key = await revealKey(row.id);
  await audit(req, { action: "asset.license_key_revealed", subjectType: "license", subjectId: row.id, after: { asset_tag: row.license_no, name: row.name } });
  await notifyReveal(req, "license", { id: row.uuid, title: row.license_no ? `${row.license_no} — ${row.name}` : row.name });
  res.json({ data: { license_key: key } });
});

/* ---------------------------------------------------------------- ไฟล์แนบ */

async function findFile(licenseId: number, id: string): Promise<LicenseFileRow> {
  const row = /^\d+$/.test(id) ? await first<LicenseFileRow>("SELECT * FROM license_files WHERE id = ? AND license_id = ? AND kind <> ?", [Number(id), licenseId, ICON_KIND]) : null;
  if (!row) throw notFound();
  return row;
}

/** POST /licenses/{uuid}/files — multipart files[] ≤ 10 ไฟล์ต่อครั้ง */
licenseRoutes.post("/licenses/:uuid/files", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  const u = me(req);
  authorize(can(u, "assets.update"));
  const data = await validate(req.input, { files: ["required", "array", "min:1", "max:10"], "files.*": FILE_RULE }, { locale: req.locale });
  const uploads = Object.values(data.files as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  for (const file of uploads) {
    const stored = await storeUploadIn(`licenses/${row.uuid}/files`, file);
    await addLicenseFile(row.id, { kind: "license", ...stored }, u.id);
  }
  res.status(201).json({ data: await resource(row) });
});

/** GET /licenses/{uuid}/files/{id}[?download=1] — pdf/รูป/ข้อความเปิดดูในเบราว์เซอร์ได้, ไฟล์อื่นดาวน์โหลด */
licenseRoutes.get("/licenses/:uuid/files/:id", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(viewsLicenses(me(req)));
  const file = await findFile(row.id, req.params.id);
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

licenseRoutes.delete("/licenses/:uuid/files/:id", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  const file = await findFile(row.id, req.params.id);
  authorize(can(me(req), "assets.update"));
  await exec("DELETE FROM license_files WHERE id = ?", [file.id]);
  await deleteStored(file.path);
  res.status(204).end();
});

/* ---------------------------------------------------------------- จัดการสัญญา */

async function forContract(req: Request) {
  const row = await findLicense(req.params.uuid);
  authorize(can(me(req), "assets.update"));
  return row;
}

/**
 * POST /licenses/{uuid}/renew { start_date?, expires_at } — ต่อสัญญาแล้ว: วันหมดอายุใหม่ต้องหลังวันเดิม
 * (วันเริ่มไม่ส่ง = วันถัดจากวันหมดอายุเดิม) → ล้างการแจ้งเตือน/การยกเลิก, หายจากแท็บกำลังจะหมดอายุถ้าพ้นช่วงแจ้งเตือน
 */
licenseRoutes.post("/licenses/:uuid/renew", async (req, res) => {
  const lic = await forContract(req);
  const oldEnd = dateOnly(lic.expires_at);
  const data = await validate(
    req.input,
    { start_date: ["nullable", "date"], expires_at: ["required", "date"] },
    {
      locale: req.locale,
      after: ({ data: d, errors }) => {
        const end = String(d.expires_at ?? "").slice(0, 10);
        const start = d.start_date ? String(d.start_date).slice(0, 10) : null;
        if (oldEnd && end && end <= oldEnd) errors.add("expires_at", trans(req.locale, "eam.license.renew_after_old"));
        if (start && end && end < start) errors.add("expires_at", trans(req.locale, "eam.license.expires_before_start"));
      },
    },
  );
  const end = String(data.expires_at).slice(0, 10);
  const start = data.start_date ? String(data.start_date).slice(0, 10) : oldEnd ? toDbDate(addDays(fromDbDate(oldEnd), 1)) : dateOnly(lic.start_date)!;
  await touchLicense(lic.id, { start_date: start, expires_at: end, notified_for_expires_at: null, cancelled_at: null, cancelled_by: null, cancel_reason: null });
  await audit(req, { action: "asset.license_renewed", subjectType: "license", subjectId: lic.id, before: { start_date: dateOnly(lic.start_date), expires_at: oldEnd }, after: { start_date: start, expires_at: end } });
  res.json({ data: await resource((await first<LicenseRow>("SELECT * FROM licenses WHERE id = ?", [lic.id]))!) });
});

/** POST /licenses/{uuid}/cancel { reason? } — ยกเลิกสัญญา: ไม่นับกำลังจะหมดอายุ/ไม่แจ้งเตือนอีก (ต่อสัญญาภายหลัง = กลับมาใช้) */
licenseRoutes.post("/licenses/:uuid/cancel", async (req, res) => {
  const lic = await forContract(req);
  const data = await validate(req.input, { reason: ["nullable", "string", "max:500"] }, { locale: req.locale });
  const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : null;
  await touchLicense(lic.id, { cancelled_at: nowDb(), cancelled_by: me(req).id, cancel_reason: reason });
  await audit(req, { action: "asset.license_cancelled", subjectType: "license", subjectId: lic.id, after: { expires_at: dateOnly(lic.expires_at), reason } });
  res.json({ data: await resource((await first<LicenseRow>("SELECT * FROM licenses WHERE id = ?", [lic.id]))!) });
});

/* ---------------------------------------------------------------- โลโก้ */

const findIcon = (id: number) => first<LicenseFileRow>("SELECT * FROM license_files WHERE license_id = ? AND kind = ? ORDER BY id DESC LIMIT 1", [id, ICON_KIND]);

/** PUT /licenses/{uuid}/icon — multipart icon รูป ≤ 1MB → WebP 256px ไม่มี metadata แทนอันเดิม */
licenseRoutes.put("/licenses/:uuid/icon", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  const u = me(req);
  authorize(can(u, "assets.update"));
  const data = await validate(req.input, { icon: ["required", "file", "image", "mimes:jpg,jpeg,png,webp,gif", "max:1024"] }, { locale: req.locale });
  const file = data.icon as UploadedFile;
  let buf: Buffer;
  try {
    buf = await processIcon(file);
  } catch {
    throw ValidationError.withMessages({ icon: trans(req.locale, "eam.meeting.image_invalid", { name: [...file.originalName].slice(0, 80).join("") }) });
  }
  const old = await findIcon(row.id);
  const path = `licenses/${row.uuid}/icon-${randomString(16)}.webp`;
  await writeStored(path, buf);
  const id = await addLicenseFile(row.id, { kind: ICON_KIND, original_name: "icon.webp", path, mime: "image/webp", size: buf.length }, u.id);
  if (old) {
    await exec("DELETE FROM license_files WHERE id = ?", [old.id]);
    await deleteStored(old.path);
  }
  await audit(req, { action: "asset.icon_updated", subjectType: "license", subjectId: row.id, after: { file_id: id } });
  res.json({ data: { icon_id: id } });
});

licenseRoutes.delete("/licenses/:uuid/icon", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(can(me(req), "assets.update"));
  const icon = await findIcon(row.id);
  if (icon) {
    await exec("DELETE FROM license_files WHERE id = ?", [icon.id]);
    await deleteStored(icon.path);
    await audit(req, { action: "asset.icon_deleted", subjectType: "license", subjectId: row.id, before: { file_id: icon.id } });
  }
  res.status(204).end();
});

licenseRoutes.get("/licenses/:uuid/icon", async (req, res) => {
  const row = await findLicense(req.params.uuid);
  authorize(viewsLicenses(me(req)));
  const icon = await findIcon(row.id);
  if (!icon) throw notFound();
  const stored = await readStored(icon.path);
  res.setHeader("Content-Type", icon.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(stored.data);
});
