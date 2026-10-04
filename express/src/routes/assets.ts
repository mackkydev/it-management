import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { localToday, nowDb, parseDate } from "../lib/time.js";
import { exists, int, regex, unique, validate, type ErrorBag, type Rules } from "../lib/validator.js";
import { limits } from "../lib/rate-limit.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { me, pageParam, paginated } from "../http.js";
import { can } from "../models/user.js";
import {
  activeCount, BILLINGS, deleteLicense, LICENSE_CATEGORY, loadFiles, loadLicense, revealKey, saveLicense, type AssetFileRow, type LicenseRow,
} from "../services/asset-licenses.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";
import {
  assetResource, MOVEMENT_JOINS, MOVEMENT_SELECT, movementResource,
  type AssetRow, type LocationRow, type MovementJoinedRow,
} from "../resources.js";
import { recordIfMoved, recordRegistration } from "../services/asset-movements.js";

/** AssetController + AssetMovementController + MovementController */
export const assetRoutes = Router();

const STATUSES = ["active", "in_storage", "in_repair", "lost", "disposed"];
const SORTABLE = ["asset_tag", "name", "category", "status", "purchase_date", "created_at"];
const TAG = /^[A-Za-z0-9\-_/]+$/;
const FILLABLE = [
  "asset_tag", "name", "category", "brand", "model", "serial_number", "status", "location_id",
  "custodian_id", "purchase_date", "purchase_cost", "warranty_expires_at", "notes",
] as const;

async function findAsset(uuid: string): Promise<AssetRow> {
  if (!isUuid(uuid)) throw notFound();
  const asset = await first<AssetRow>("SELECT * FROM assets WHERE uuid = ? AND deleted_at IS NULL", [uuid]);
  if (!asset) throw notFound();
  return asset;
}

/** โหลด location (เต็ม) + custodian + license + ไฟล์ แบบ $asset->load([...]) */
async function withRelations(a: AssetRow) {
  const location = a.location_id
    ? await first<LocationRow>("SELECT id, code, name, type, parent_id, address, is_active FROM locations WHERE id = ? AND deleted_at IS NULL", [a.location_id])
    : null;
  const custodian = a.custodian_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [a.custodian_id]) : null;
  return { location, custodian, license: await loadLicense(a.id), files: await loadFiles(a.id) };
}

/**
 * กฎของข้อมูล license — ใช้เมื่อหมวด (ค่าใหม่ หรือค่าเดิมถ้าไม่ได้ส่งมา) เป็น SOFTWARE
 * บังคับส่ง license ตอนเพิ่มใหม่/เปลี่ยนมาเป็น SOFTWARE; แก้ไขโดยไม่ส่ง license = คงค่าเดิม
 */
function licenseRules(input: Record<string, unknown>, current?: AssetRow): Rules {
  const category = "category" in input ? input.category : current?.category;
  if (category !== LICENSE_CATEGORY) return {};
  const required = !current || current.category !== LICENSE_CATEGORY;
  if (!required && !("license" in input)) return {};
  return {
    license: ["required", "array"],
    "license.billing": ["required", `in:${BILLINGS.join(",")}`],
    "license.start_date": ["required", "date"],
    "license.expires_at": ["required_if:license.billing,yearly,custom", "nullable", "date"],
    "license.seats": ["nullable", "integer", "min:1", "max:1000000"],
    "license.vendor": ["nullable", "string", "max:255"],
    "license.license_key": ["nullable", "string", "max:5000"],
    "license.clear_license_key": ["sometimes", "boolean"],
    "license.notify_days_before": ["nullable", "integer", "min:1", "max:365"],
  };
}

/** วันหมดอายุต้องไม่ก่อนวันเริ่ม (Laravel ทำใน after() เหมือนกัน — after_or_equal อ้างฟิลด์ซ้อนไม่ได้ตรงกันทั้งสองฝั่ง) */
const licenseAfter = (req: Request, currentId?: number) => async ({ data, errors }: { data: Record<string, unknown>; errors: ErrorBag }) => {
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

function assetRules(ignoreId?: number): Rules {
  const s = ignoreId ? ["sometimes"] : [];
  const r = (rules: Rules[string]) => (ignoreId ? ["sometimes", ...rules.filter((x) => x !== "sometimes")] : rules);
  return {
    asset_tag: [...s, "required", "string", "max:50", regex(TAG), unique("assets", "asset_tag", ignoreId)],
    name: r(["required", "string", "max:255"]),
    category: r(["required", "string", "max:50"]),
    brand: r(["nullable", "string", "max:100"]),
    model: r(["nullable", "string", "max:100"]),
    serial_number: r(["nullable", "string", "max:100"]),
    status: ["sometimes", `in:${STATUSES.join(",")}`],
    location_id: r(["nullable", "integer", exists("locations", "id", "deleted_at IS NULL")]),
    custodian_id: r(["nullable", "integer", exists("users", "id", "is_active = true")]),
    purchase_date: r(["nullable", "date", `before_or_equal:${localToday()}`]),
    purchase_cost: r(["nullable", "numeric", "min:0", "max:9999999999999.99"]),
    warranty_expires_at: r(["nullable", "date"]),
    notes: r(["nullable", "string", "max:5000"]),
    ...(ignoreId ? { movement_reason: ["sometimes", "nullable", "string", "max:1000"] } : {}),
  };
}

const assetMessages = (req: Request) => ({
  "asset_tag.regex": trans(req.locale, "eam.validation.asset_tag_regex"),
  "asset_tag.unique": trans(req.locale, "eam.validation.asset_tag_unique"),
  "purchase_date.before_or_equal": trans(req.locale, "eam.validation.purchase_date_future"),
});

/** ค่าจาก input → ค่าที่เก็บใน DB (ตาม cast ของ model) */
function columnValue(key: string, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (key === "location_id" || key === "custodian_id") return int(v);
  if (key === "purchase_date" || key === "warranty_expires_at") return String(v).slice(0, 10);
  if (key === "purchase_cost") return Number(v).toFixed(2);
  return v;
}

/* ---------------------------------------------------------------- assets */

/** GET /assets?search=&status=&category=&location_id=&sort=-created_at&per_page=25&page=1 */
assetRoutes.get("/assets", async (req, res) => {
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      status: ["nullable", `in:${STATUSES.join(",")}`],
      category: ["nullable", "string", "max:50"],
      location_id: ["nullable", "integer"],
      sort: ["nullable", "string", `in:${[...SORTABLE, ...SORTABLE.map((c) => `-${c}`)].join(",")}`],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );

  const sort = (f.sort as string | null) ?? "-created_at";
  const dir = sort.startsWith("-") ? "DESC" : "ASC";
  const column = sort.replace(/^-/, ""); // อยู่ใน whitelist แล้ว
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);

  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  const term = String(f.search ?? "").trim();
  if (term) {
    const esc = likeEscape(term);
    // asset_tag / serial ใช้ prefix match, ชื่อ/ยี่ห้อ/รุ่น ค้นหาบางส่วนของคำ (index trigram — รองรับภาษาไทย)
    where.push("(a.asset_tag ILIKE ? OR a.serial_number ILIKE ? OR a.name ILIKE ? OR a.brand ILIKE ? OR a.model ILIKE ?)");
    params.push(`${esc}%`, `${esc}%`, `%${esc}%`, `%${esc}%`, `%${esc}%`);
  }
  if (f.status) (where.push("a.status = ?"), params.push(f.status));
  if (f.category) (where.push("a.category = ?"), params.push(f.category));
  if (f.location_id) (where.push("a.location_id = ?"), params.push(int(f.location_id)));
  const whereSql = where.join(" AND ");

  const total = Number(await scalar(`SELECT COUNT(*) FROM assets a WHERE ${whereSql}`, params));
  const rows = await select<
    AssetRow & {
      l_id: number | null; l_code: string; l_name: string; l_type: string; l_parent_id: number | null; c_id: number | null; c_name: string;
      li_id: number | null; li_billing: string; li_start_date: string; li_expires_at: string | null; li_seats: number | null;
      li_vendor: string | null; li_notify: number | null; li_has_key: boolean;
    }
  >(
    `SELECT a.*, l.id AS l_id, l.code AS l_code, l.name AS l_name, l.type AS l_type, l.parent_id AS l_parent_id, c.id AS c_id, c.name AS c_name,
            li.id AS li_id, li.billing AS li_billing, li.start_date AS li_start_date, li.expires_at AS li_expires_at, li.seats AS li_seats,
            li.vendor AS li_vendor, li.notify_days_before AS li_notify, (li.license_key IS NOT NULL) AS li_has_key
       FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id AND l.deleted_at IS NULL
       LEFT JOIN users c ON c.id = a.custodian_id
       LEFT JOIN asset_licenses li ON li.asset_id = a.id
      WHERE ${whereSql}
      ORDER BY a."${column}" ${dir}${column === "purchase_date" ? (dir === "ASC" ? " NULLS FIRST" : " NULLS LAST") : ""}, a.id ${dir}
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );

  const data = rows.map((r) =>
    assetResource(r, req.locale, {
      // index โหลด location เฉพาะ id,code,name,type,parent_id
      location: r.l_id ? { id: r.l_id, code: r.l_code, name: r.l_name, type: r.l_type, parent_id: r.l_parent_id } : null,
      custodian: r.c_id ? { id: r.c_id, name: r.c_name } : null,
      license: r.li_id
        ? ({
            id: r.li_id, asset_id: r.id, billing: r.li_billing, start_date: r.li_start_date, expires_at: r.li_expires_at, seats: r.li_seats,
            vendor: r.li_vendor, notify_days_before: r.li_notify, license_key: r.li_has_key ? "" : null, notified_for_expires_at: null,
          } satisfies LicenseRow)
        : null,
    }),
  );
  res.json(paginated(req, data, total, page, perPage));
});

/**
 * GET /assets/suggestions?field=brand|model&q=&brand= — ค่าที่มีอยู่แล้ว (ไม่ซ้ำ ไม่สนตัวพิมพ์) สำหรับช่องพิมพ์แล้วแนะนำ
 * รุ่นกรองตามยี่ห้อที่เลือกได้ — ต้องประกาศก่อน /assets/:uuid
 */
assetRoutes.get("/assets/suggestions", async (req, res) => {
  const f = await validate(
    req.input,
    { field: ["required", "in:brand,model"], q: ["nullable", "string", "max:100"], brand: ["nullable", "string", "max:100"] },
    { locale: req.locale },
  );
  const column = f.field === "brand" ? "brand" : "model"; // อยู่ใน whitelist แล้ว
  const where = [`a.deleted_at IS NULL`, `a.${column} IS NOT NULL`, `TRIM(a.${column}) <> ''`];
  const params: unknown[] = [];
  const term = String(f.q ?? "").trim();
  if (term) (where.push(`a.${column} ILIKE ?`), params.push(`%${likeEscape(term)}%`));
  const brand = String(f.brand ?? "").trim();
  if (column === "model" && brand) (where.push("LOWER(TRIM(a.brand)) = LOWER(?)"), params.push(brand));
  // ค่าเดียวกันที่ต่างแค่ตัวพิมพ์ ใช้ตัวสะกดที่บันทึกก่อน แล้วเรียงตามตัวอักษร (ไม่สนตัวพิมพ์)
  const rows = await select<{ value: string; first_id: number }>(
    `SELECT TRIM(a.${column}) AS value, MIN(a.id) AS first_id FROM assets a WHERE ${where.join(" AND ")}
      GROUP BY TRIM(a.${column}) ORDER BY first_id LIMIT 200`,
    params,
  );
  const unique = new Map<string, string>();
  for (const r of rows) if (!unique.has(r.value.toLowerCase())) unique.set(r.value.toLowerCase(), r.value);
  const values = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
  res.json({ data: values.slice(0, 10) });
});

assetRoutes.post("/assets", async (req, res) => {
  const data = await validate(req.input, { ...assetRules(), ...licenseRules(req.input) }, { locale: req.locale, messages: assetMessages(req), after: licenseAfter(req) });
  const u = me(req);
  authorize(can(u, "assets.manage"));

  const id = await transaction(async () => {
    const now = nowDb();
    const values: Record<string, unknown> = {};
    for (const key of FILLABLE) if (key in data) values[key] = columnValue(key, data[key]);
    const assetId = await insert("assets", {
      uuid: randomUUID(),
      status: "active",
      ...values,
      created_by: u.id,
      updated_by: u.id,
      created_at: now,
      updated_at: now,
    });
    await recordRegistration(assetId, (values.location_id as number) ?? null, (values.custodian_id as number) ?? null, u.id);
    if (values.category === LICENSE_CATEGORY) await saveLicense(assetId, data.license as Record<string, unknown>);
    return assetId;
  });

  const asset = (await first<AssetRow>("SELECT * FROM assets WHERE id = ?", [id]))!;
  res.status(201).json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
});

assetRoutes.get("/assets/:uuid", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  res.json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
});

/** PUT/PATCH — ถ้าสถานที่/ผู้ถือครองเปลี่ยน บันทึกประวัติการโอนย้ายอัตโนมัติ (movement_reason = เหตุผล) */
async function updateAsset(req: Request, res: import("express").Response) {
  const current = await findAsset(String(req.params.uuid));
  const data = await validate(req.input, { ...assetRules(current.id), ...licenseRules(req.input, current) }, {
    locale: req.locale,
    messages: assetMessages(req),
    after: licenseAfter(req, current.id),
  });
  const u = me(req);
  authorize(can(u, "assets.manage"));

  await transaction(async () => {
    // ล็อกแถวกันการแก้ไขพร้อมกัน ไม่ให้ค่า "จาก" ในประวัติคลาดเคลื่อน
    const locked = (await first<AssetRow>("SELECT * FROM assets WHERE id = ? FOR UPDATE", [current.id]))!;
    const changes: Record<string, unknown> = {};
    for (const key of FILLABLE) if (key in data) changes[key] = columnValue(key, data[key]);
    await update("assets", { ...changes, updated_by: u.id, updated_at: nowDb() }, "id = ?", [current.id]);

    const to = {
      location: "location_id" in changes ? (changes.location_id as number | null) : locked.location_id,
      custodian: "custodian_id" in changes ? (changes.custodian_id as number | null) : locked.custodian_id,
    };
    await recordIfMoved(current.id, { location: locked.location_id, custodian: locked.custodian_id }, to, u.id, (data.movement_reason as string) ?? null);

    // license ตามหมวดใหม่: SOFTWARE → บันทึก (ถ้าส่งมา), หมวดอื่น → ลบ (ไฟล์แนบยังเก็บไว้)
    const category = "category" in changes ? changes.category : locked.category;
    if (category === LICENSE_CATEGORY) {
      if ("license" in data) await saveLicense(current.id, data.license as Record<string, unknown>);
    } else {
      await deleteLicense(current.id);
    }
  });

  const asset = (await first<AssetRow>("SELECT * FROM assets WHERE id = ?", [current.id]))!;
  res.json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
}

assetRoutes.put("/assets/:uuid", updateAsset);
assetRoutes.patch("/assets/:uuid", updateAsset);

/** Soft delete — เก็บประวัติไว้เพื่อการตรวจสอบ */
assetRoutes.delete("/assets/:uuid", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  authorize(can(me(req), "assets.delete"));
  await update("assets", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [asset.id]);
  res.status(204).end();
});

/* ---------------------------------------------------------------- license key + ไฟล์ */

/** ดู license key (ถอดรหัส) — ผู้จัดการสินทรัพย์ หรือฝ่าย IT */
assetRoutes.post("/assets/:uuid/license-key", limits.reveal, async (req, res) => {
  const asset = await findAsset(String(req.params.uuid));
  const u = me(req);
  authorize(can(u, "assets.license_key"));
  res.json({ data: { license_key: await revealKey(asset.id) } });
});

const FILE_RULE = ["file", "mimes:pdf,txt,xml,zip,jpg,jpeg,png,webp,doc,docx,xls,xlsx", "max:10240"]; // ≤ 10MB
/** พรีวิวในเบราว์เซอร์ได้ (ที่เหลือดาวน์โหลด) */
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

/** POST /assets/{uuid}/files — อัปโหลดไฟล์ license (multipart files[] ≤ 10 ไฟล์ต่อครั้ง) */
assetRoutes.post("/assets/:uuid/files", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const u = me(req);
  authorize(can(u, "assets.manage"));
  const data = await validate(req.input, { files: ["required", "array", "min:1", "max:10"], "files.*": FILE_RULE }, { locale: req.locale });

  const uploads = Object.values(data.files as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const now = nowDb();
  for (const file of uploads) {
    const stored = await storeUploadIn(`assets/${asset.uuid}/files`, file);
    await insert("asset_files", { asset_id: asset.id, kind: "license", ...stored, uploaded_by: u.id, created_at: now, updated_at: now });
  }
  res.status(201).json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
});

/** GET /assets/{uuid}/files/{id}[?download=1] — pdf/รูป/ข้อความเปิดดูในเบราว์เซอร์ได้, ไฟล์อื่นดาวน์โหลด */
assetRoutes.get("/assets/:uuid/files/:id", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const file = await findFile(asset.id, req.params.id);
  const stored = await readStored(file.path);
  const inline = !("download" in req.query) && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
});

/** ลบไฟล์ — ผู้จัดการสินทรัพย์ */
assetRoutes.delete("/assets/:uuid/files/:id", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const file = await findFile(asset.id, req.params.id);
  authorize(can(me(req), "assets.manage"));
  await exec("DELETE FROM asset_files WHERE id = ?", [file.id]);
  await deleteStored(file.path);
  res.status(204).end();
});

async function findFile(assetId: number, id: string): Promise<AssetFileRow> {
  const row = /^\d+$/.test(id) ? await first<AssetFileRow>("SELECT * FROM asset_files WHERE id = ? AND asset_id = ?", [Number(id), assetId]) : null;
  if (!row) throw notFound();
  return row;
}

/* ---------------------------------------------------------------- movements ของสินทรัพย์ */

/** GET /assets/{uuid}/movements?per_page=20 — ล่าสุดก่อน */
assetRoutes.get("/assets/:uuid/movements", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const f = await validate(req.input, { per_page: ["nullable", "integer", "min:1", "max:100"] }, { locale: req.locale });
  const perPage = int(f.per_page) ?? 20;
  const page = pageParam(req);

  const total = Number(await scalar("SELECT COUNT(*) FROM asset_movements WHERE asset_id = ?", [asset.id]));
  const rows = await select<MovementJoinedRow>(
    `SELECT ${MOVEMENT_SELECT} FROM asset_movements m ${MOVEMENT_JOINS}
      WHERE m.asset_id = ? ORDER BY m.moved_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    [asset.id, perPage, (page - 1) * perPage],
  );
  res.json(paginated(req, rows.map((m) => movementResource(m, req.locale)), total, page, perPage));
});

/** POST /assets/{uuid}/movements — โอนย้ายสถานที่/ผู้ถือครอง และบันทึกประวัติในคราวเดียว */
assetRoutes.post("/assets/:uuid/movements", async (req, res) => {
  const current = await findAsset(req.params.uuid);
  const input = req.input;
  const data = await validate(
    input,
    {
      location_id: ["sometimes", "nullable", "integer", exists("locations", "id", "deleted_at IS NULL")],
      custodian_id: ["sometimes", "nullable", "integer", exists("users", "id", "is_active = true")],
      moved_at: ["nullable", "date", "before_or_equal:now"],
      reason: ["nullable", "string", "max:1000"],
    },
    {
      locale: req.locale,
      messages: { "moved_at.before_or_equal": trans(req.locale, "eam.movement.future_date") },
      after: ({ errors }) => {
        if (!("location_id" in input) && !("custodian_id" in input)) {
          errors.add("location_id", trans(req.locale, "eam.movement.nothing_to_change"));
        }
      },
    },
  );
  const u = me(req);
  authorize(can(u, "assets.manage"));

  const movementId = await transaction(async () => {
    const locked = (await first<AssetRow>("SELECT * FROM assets WHERE id = ? FOR UPDATE", [current.id]))!;
    const to = {
      location: "location_id" in data ? int(data.location_id) : locked.location_id,
      custodian: "custodian_id" in data ? int(data.custodian_id) : locked.custodian_id,
    };
    const movedAt = data.moved_at ? parseDate(data.moved_at) : null;
    const id = await recordIfMoved(current.id, { location: locked.location_id, custodian: locked.custodian_id }, to, u.id, (data.reason as string) ?? null, movedAt);
    if (!id) throw ValidationError.withMessages({ location_id: trans(req.locale, "eam.movement.no_change") });

    await update("assets", { location_id: to.location, custodian_id: to.custodian, updated_by: u.id, updated_at: nowDb() }, "id = ?", [current.id]);
    return id;
  });

  const row = (await first<MovementJoinedRow>(`SELECT ${MOVEMENT_SELECT} FROM asset_movements m ${MOVEMENT_JOINS} WHERE m.id = ?`, [movementId]))!;
  res.status(201).json({ data: movementResource(row, req.locale) });
});

/* ---------------------------------------------------------------- รายงานการโอนย้ายรวม */

/** GET /movements?search=เลขครุภัณฑ์&location_id=&type=&from=&to=&per_page= */
assetRoutes.get("/movements", async (req, res) => {
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      location_id: ["nullable", "integer"],
      type: ["nullable", "in:registered,transfer"],
      from: ["nullable", "date"],
      to: ["nullable", "date", "after_or_equal:from"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  const search = String(f.search ?? "").trim();
  if (search) (where.push("a.asset_tag ILIKE ?"), params.push(`${likeEscape(search)}%`));
  if (f.location_id) (where.push("(m.to_location_id = ? OR m.from_location_id = ?)"), params.push(int(f.location_id), int(f.location_id)));
  if (f.type) (where.push("m.type = ?"), params.push(f.type));
  if (f.from) (where.push("m.moved_at >= ?"), params.push(String(f.from).slice(0, 10)));
  if (f.to) {
    const end = parseDate(String(f.to).slice(0, 10))!;
    end.setUTCDate(end.getUTCDate() + 1);
    where.push("m.moved_at < ?");
    params.push(end.toISOString().slice(0, 10));
  }
  const whereSql = where.join(" AND ");
  // whereHas('asset') ของ Laravel ใช้ SoftDeletes scope → ค้นเฉพาะสินทรัพย์ที่ยังไม่ถูกลบ
  const searchJoin = search ? "JOIN assets a ON a.id = m.asset_id AND a.deleted_at IS NULL" : "LEFT JOIN assets a ON a.id = m.asset_id";

  const total = Number(await scalar(`SELECT COUNT(*) FROM asset_movements m ${searchJoin} WHERE ${whereSql}`, params));
  const rows = await select<MovementJoinedRow>(
    `SELECT ${MOVEMENT_SELECT}, a.uuid AS a_uuid, a.asset_tag AS a_tag, a.name AS a_name
       FROM asset_movements m ${searchJoin} ${MOVEMENT_JOINS}
      WHERE ${whereSql}
      ORDER BY m.moved_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  res.json(paginated(req, rows.map((m) => movementResource(m, req.locale, true)), total, page, perPage));
});
