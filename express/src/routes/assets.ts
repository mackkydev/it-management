import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, localToday, nowDb, parseDate } from "../lib/time.js";
import { exists, int, regex, unique, validate, type ErrorBag, type Rules } from "../lib/validator.js";
import { limits } from "../lib/rate-limit.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { me, pageParam, paginated } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import {
  activeCount, BILLINGS, deleteLicense, LICENSE_CATEGORY, loadFiles, loadLicense, revealKey, saveLicense, type AssetFileRow, type LicenseRow,
} from "../services/asset-licenses.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";
import {
  assetResource, MOVEMENT_JOINS, MOVEMENT_SELECT, movementResource,
  type AssetRow, type LocationRow, type MovementJoinedRow,
} from "../resources.js";
import { recordIfMoved, recordRegistration, recordUserChange } from "../services/asset-movements.js";
import { REPAIR_BASE_WHERE, REPAIR_FROM, repairList } from "../services/asset-repairs.js";
import { COMPUTER_CATEGORY, COMPUTER_DATE_FIELDS, COMPUTER_TEXT_FIELDS, buildExport, buildTemplate, importRows, parseWorkbook } from "../services/asset-import.js";
import { audit } from "../services/audit.js";
import { assertCanReveal, notifyReveal } from "../services/secret-guard.js";
import { loadSoftware, softwareErrors, softwareOptions, syncSoftware, SOFTWARE_SLOTS } from "../services/asset-software.js";

/** AssetController + AssetMovementController + MovementController */
export const assetRoutes = Router();

const STATUSES = ["active", "in_storage", "in_repair", "lost", "disposed"];
const SORTABLE = ["asset_tag", "name", "category", "status", "purchase_date", "created_at"];
const TAG = /^[A-Za-z0-9\-_/]+$/;
const FILLABLE = [
  "asset_tag", "name", "category", "brand", "model", "serial_number", "status", "location_id",
  "custodian_id", "purchase_date", "purchase_cost", "warranty_expires_at", "notes", "branch_id",
  ...(Object.keys(COMPUTER_TEXT_FIELDS) as (keyof typeof COMPUTER_TEXT_FIELDS)[]),
  ...COMPUTER_DATE_FIELDS,
] as const;

async function findAsset(uuid: string): Promise<AssetRow> {
  if (!isUuid(uuid)) throw notFound();
  const asset = await first<AssetRow>("SELECT * FROM assets WHERE uuid = ? AND deleted_at IS NULL", [uuid]);
  if (!asset) throw notFound();
  return asset;
}

/** เห็นสินทรัพย์ทั้งหมด (ฝ่าย IT / ผู้จัดการสินทรัพย์) — ไม่มีสิทธิ์ = เห็นเฉพาะที่ตัวเองถือครอง */
/** เพิ่มหรือแก้ไขสินทรัพย์ได้ (ตัวเลือกในฟอร์ม เช่น ซอฟต์แวร์ / เลขครุภัณฑ์) */
const editsAssets = (u: UserRow) => can(u, "assets.create") || can(u, "assets.update");
const seesAllAssets = (u: UserRow) => can(u, "assets.view_all") || editsAssets(u);

/** สินทรัพย์ "ของฉัน": เป็นผู้ถือครอง หรือชื่อผู้ใช้งาน (ทะเบียนคอมพิวเตอร์ — ข้อความจาก Excel) ตรงกับชื่อตัวเอง */
export const OWN_SQL = "(a.custodian_id = ? OR (a.user_name IS NOT NULL AND LOWER(TRIM(a.user_name)) = LOWER(TRIM(?))))";
const isOwn = (u: UserRow, a: AssetRow) =>
  Number(a.custodian_id) === u.id || (a.user_name !== null && a.user_name.trim().toLowerCase() === u.name.trim().toLowerCase());

/** findAsset + ตรวจว่าผู้ใช้เห็นได้ (ของคนอื่น = ไม่พบ ไม่บอกว่ามีอยู่) */
async function findVisibleAsset(req: Request, uuid: string): Promise<AssetRow> {
  const asset = await findAsset(uuid);
  const u = me(req);
  if (!seesAllAssets(u) && !isOwn(u, asset)) throw notFound();
  return asset;
}

/** โหลด location (เต็ม) + custodian + license + ไฟล์ แบบ $asset->load([...]) */
async function withRelations(a: AssetRow) {
  const location = a.location_id
    ? await first<LocationRow>("SELECT id, code, name, type, parent_id, address, is_active FROM locations WHERE id = ? AND deleted_at IS NULL", [a.location_id])
    : null;
  const custodian = a.custodian_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [a.custodian_id]) : null;
  const branch = a.branch_id ? await first<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = ?", [a.branch_id]) : null;
  return { location, custodian, branch, license: await loadLicense(a.id), files: await loadFiles(a.id), software: await loadSoftware(a.id) };
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
/** license + ซอฟต์แวร์ที่ติดตั้ง (input.software — ต้องเป็น license จริง) */
const assetAfter = (req: Request, currentId?: number) => async (ctx: { data: Record<string, unknown>; errors: ErrorBag }) => {
  await licenseAfter(req, currentId)(ctx);
  if ("software" in req.input) for (const [k, m] of Object.entries(await softwareErrors(req.input.software, req.locale))) ctx.errors.add(k, m);
};

/**
 * ซอฟต์แวร์ที่เลือกในฟอร์ม → การติดตั้ง license ของเครื่องนี้ + ชื่อในคอลัมน์ os / office / antivirus
 * ช่องที่ไม่ได้ผูก license คงข้อความที่ส่งมา (เช่น ค่าเดิมจาก Excel)
 */
async function applySoftware(req: Request, assetId: number, userId: number) {
  if (!("software" in req.input)) return;
  const a = (await first<AssetRow>("SELECT * FROM assets WHERE id = ?", [assetId]))!;
  const names = await syncSoftware({ id: a.id, custodian_id: a.custodian_id, branch_id: a.branch_id }, req.input.software, userId, req.locale);
  const linked = Object.fromEntries(SOFTWARE_SLOTS.filter((s) => names[s]).map((s) => [s, names[s]!.slice(0, 100)]));
  if (Object.keys(linked).length) await update("assets", linked, "id = ?", [assetId]);
}

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
    branch_id: r(["nullable", "integer", exists("branches", "id", "deleted_at IS NULL")]),
    // ข้อมูลเครื่องคอมพิวเตอร์ (ใช้กับหมวด COMPUTER — หมวดอื่นส่งมาได้แต่ฟอร์มไม่แสดง)
    ...Object.fromEntries(Object.entries(COMPUTER_TEXT_FIELDS).map(([k, max]) => [k, r(["nullable", "string", `max:${max}`])])),
    ...Object.fromEntries(COMPUTER_DATE_FIELDS.map((k) => [k, r(["nullable", "date"])])),
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
  if (key === "location_id" || key === "custodian_id" || key === "branch_id") return int(v);
  if ((COMPUTER_DATE_FIELDS as readonly string[]).includes(key)) return String(v).slice(0, 10);
  if (key === "purchase_date" || key === "warranty_expires_at") return String(v).slice(0, 10);
  if (key === "purchase_cost") return Number(v).toFixed(2);
  return v;
}

/* ---------------------------------------------------------------- assets */

const FILTER_RULES: Rules = {
  search: ["nullable", "string", "max:100"],
  status: ["nullable", `in:${STATUSES.join(",")}`],
  category: ["nullable", "string", "max:50"],
  location_id: ["nullable", "integer"],
  branch_id: ["nullable", "integer"],
};

/** เงื่อนไขของตัวกรองหน้ารายการ (ใช้ทั้งรายการและส่งออก Excel) — ไม่มีสิทธิ์ดูทั้งหมด = เฉพาะที่ตัวเองถือครอง */
function filterWhere(req: Request, f: Record<string, unknown>): { whereSql: string; params: unknown[] } {
  const where = ["a.deleted_at IS NULL"];
  const params: unknown[] = [];
  const term = String(f.search ?? "").trim();
  if (term) {
    const esc = likeEscape(term);
    // asset_tag (Host Name) / serial ใช้ prefix match, ชื่อ/ยี่ห้อ/รุ่น/ผู้ใช้งาน/IP ค้นหาบางส่วนของคำ
    where.push("(a.asset_tag LIKE ? OR a.serial_number LIKE ? OR a.name LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR a.user_name LIKE ? OR a.ip_address LIKE ?)");
    params.push(`${esc}%`, `${esc}%`, `%${esc}%`, `%${esc}%`, `%${esc}%`, `%${esc}%`, `${esc}%`);
  }
  if (f.status) (where.push("a.status = ?"), params.push(f.status));
  if (f.category) (where.push("a.category = ?"), params.push(f.category));
  if (f.location_id) (where.push("a.location_id = ?"), params.push(int(f.location_id)));
  if (f.branch_id) (where.push("a.branch_id = ?"), params.push(int(f.branch_id)));
  // ไม่มีสิทธิ์ดูทั้งหมด → เฉพาะที่ตัวเองถือครอง
  const viewer = me(req);
  if (!seesAllAssets(viewer)) (where.push(OWN_SQL), params.push(viewer.id, viewer.name));
  return { whereSql: where.join(" AND "), params };
}

/** GET /assets?search=&status=&category=&location_id=&branch_id=&sort=-created_at&per_page=25&page=1 */
assetRoutes.get("/assets", async (req, res) => {
  const f = await validate(
    req.input,
    {
      ...FILTER_RULES,
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
  const { whereSql, params } = filterWhere(req, f);

  const total = Number(await scalar(`SELECT COUNT(*) FROM assets a WHERE ${whereSql}`, params));
  const rows = await select<
    AssetRow & {
      l_id: number | null; l_code: string; l_name: string; l_type: string; l_parent_id: number | null; c_id: number | null; c_name: string;
      li_id: number | null; li_billing: string; li_start_date: string; li_expires_at: string | null; li_seats: number | null;
      li_vendor: string | null; li_notify: number | null; li_has_key: boolean; li_used: number | null; b_name: string | null;
    }
  >(
    `SELECT a.*, l.id AS l_id, l.code AS l_code, l.name AS l_name, l.type AS l_type, l.parent_id AS l_parent_id, c.id AS c_id, c.name AS c_name,
            li.id AS li_id, li.billing AS li_billing, li.start_date AS li_start_date, li.expires_at AS li_expires_at, li.seats AS li_seats,
            li.vendor AS li_vendor, li.notify_days_before AS li_notify, (li.license_key IS NOT NULL) AS li_has_key, br.name AS b_name,
            (SELECT COUNT(*) FROM license_installations i WHERE li.id IS NOT NULL AND i.license_asset_id = a.id AND i.uninstalled_at IS NULL) AS li_used
       FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id AND l.deleted_at IS NULL
       LEFT JOIN users c ON c.id = a.custodian_id
       LEFT JOIN asset_licenses li ON li.asset_id = a.id
       LEFT JOIN branches br ON br.id = a.branch_id
      WHERE ${whereSql}
      ORDER BY a."${column}" ${dir}, a.id ${dir}
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );

  const data = rows.map((r) => ({
    ...assetResource(r, req.locale, {
      // index โหลด location เฉพาะ id,code,name,type,parent_id
      location: r.l_id ? { id: r.l_id, code: r.l_code, name: r.l_name, type: r.l_type, parent_id: r.l_parent_id } : null,
      custodian: r.c_id ? { id: r.c_id, name: r.c_name } : null,
      branch: r.branch_id && r.b_name ? { id: r.branch_id, name: r.b_name } : null,
      license: r.li_id
        ? ({
            id: r.li_id, asset_id: r.id, billing: r.li_billing, start_date: r.li_start_date, expires_at: r.li_expires_at, seats: r.li_seats,
            vendor: r.li_vendor, notify_days_before: r.li_notify, license_key: r.li_has_key ? "" : null, notified_for_expires_at: null,
          } satisfies LicenseRow)
        : null,
    }),
    // license: จำนวนที่ติดตั้งใช้อยู่ / คงเหลือ (seats null = ไม่จำกัด)
    ...(r.li_id ? { license_usage: { seats: r.li_seats, used: Number(r.li_used ?? 0), available: r.li_seats === null ? null : Math.max(0, r.li_seats - Number(r.li_used ?? 0)) } } : {}),
  }));
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
  if (term) (where.push(`a.${column} LIKE ?`), params.push(`%${likeEscape(term)}%`));
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

/**
 * GET /assets/tag-suggestions?q= — เลขครุภัณฑ์จากทะเบียนสินทรัพย์ (ช่องเลขที่ทรัพย์สิน Monitor ของทะเบียนคอมพิวเตอร์)
 * ไม่รวมหมวด COMPUTER (รหัส = Host Name) และ Software — พิมพ์ค่าที่ไม่มีในทะเบียนเองได้ที่ฟอร์ม
 */
assetRoutes.get("/assets/tag-suggestions", async (req, res) => {
  authorize(editsAssets(me(req)));
  const f = await validate(req.input, { q: ["nullable", "string", "max:100"] }, { locale: req.locale });
  const where = ["a.deleted_at IS NULL", "a.category NOT IN (?)"];
  const params: unknown[] = [[COMPUTER_CATEGORY, LICENSE_CATEGORY]];
  const term = String(f.q ?? "").trim();
  if (term) {
    const esc = likeEscape(term);
    where.push("(a.asset_tag LIKE ? OR a.name LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ?)");
    params.push(`%${esc}%`, `%${esc}%`, `%${esc}%`, `${esc}%`);
  }
  const rows = await select<{ asset_tag: string; name: string; brand: string | null; model: string | null; category: string }>(
    `SELECT a.asset_tag, a.name, a.brand, a.model, a.category FROM assets a WHERE ${where.join(" AND ")}
      ORDER BY (a.asset_tag LIKE ?) DESC, a.asset_tag LIMIT 10`,
    [...params, `${likeEscape(term)}%`],
  );
  res.json({ data: rows });
});

/** GET /assets/software-options — license ทั้งหมด + seat ใช้ไป/คงเหลือ (ตัวเลือก OS / Office / Anti Virus / Software อื่นๆ) */
assetRoutes.get("/assets/software-options", async (req, res) => {
  authorize(editsAssets(me(req)));
  res.json({ data: await softwareOptions() });
});

/* ---------------------------------------------------------------- import ทะเบียนคอมพิวเตอร์ (Excel) */

/** GET /assets/import-template — template .xlsx (หัวตารางตามทะเบียนเดิม + แผ่นคำอธิบาย) */
assetRoutes.get("/assets/import-template", async (req, res) => {
  authorize(can(me(req), "assets.create"));
  const name = "asset-import-template.xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"; filename*=utf-8''${encodeURIComponent(name)}`);
  res.send(await buildTemplate(req.locale));
});

/** จำนวนแถวสูงสุดของไฟล์ส่งออก */
const EXPORT_MAX = 20000;

/**
 * GET /assets/export?search=&status=&branch_id=&location_id= — ทะเบียนคอมพิวเตอร์เป็น Excel ตามตัวกรองที่เลือก
 * คอลัมน์เดียวกับ template นำเข้า (นำไฟล์กลับเข้ามาได้) — เฉพาะหมวด COMPUTER (ตัวกรองหมวดอื่น = ไฟล์ว่าง)
 */
assetRoutes.get("/assets/export", async (req, res) => {
  authorize(seesAllAssets(me(req)));
  const f = await validate(req.input, FILTER_RULES, { locale: req.locale });
  const { whereSql, params } = filterWhere(req, f);
  const rows = await select<AssetRow>(
    `SELECT a.* FROM assets a WHERE ${whereSql} AND a.category = ? ORDER BY a.asset_tag, a.id LIMIT ?`,
    [...params, COMPUTER_CATEGORY, EXPORT_MAX],
  );
  const name = `computers-${localToday()}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"; filename*=utf-8''${encodeURIComponent(name)}`);
  res.setHeader("Cache-Control", "no-store");
  res.send(await buildExport(rows, req.locale));
});

/**
 * POST /assets/import (multipart: file) — นำเข้าทะเบียนคอมพิวเตอร์ (หมวด COMPUTER, Host Name = รหัส, เจอเดิม = อัปเดต)
 * ตรวจทุกแถวก่อน: ผิดแม้แถวเดียว = 422 + รายการแถวที่ผิด (ไม่บันทึกเลย)
 */
assetRoutes.post("/assets/import", async (req, res) => {
  const u = me(req);
  authorize(can(u, "assets.create") && can(u, "assets.update"));
  const data = await validate(req.input, { file: ["required", "file", "mimes:xlsx", "max:5120"] }, { locale: req.locale });
  const file = data.file as UploadedFile;

  const parsed = await parseWorkbook(file.buffer, req.locale);
  const outcome = parsed.errors.length ? { errors: parsed.errors } : await importRows(parsed.rows, u.id, req.locale);
  if ("errors" in outcome) {
    res.status(422).json({ message: trans(req.locale, "eam.asset_import.failed"), rows: outcome.errors });
    return;
  }
  await audit(req, {
    action: "asset.imported",
    subjectType: "asset",
    after: { file: file.originalName, created: outcome.created, updated: outcome.updated, warnings: outcome.warnings.length },
  });
  res.json({ data: outcome });
});

assetRoutes.post("/assets", async (req, res) => {
  const data = await validate(req.input, { ...assetRules(), ...licenseRules(req.input) }, { locale: req.locale, messages: assetMessages(req), after: assetAfter(req) });
  const u = me(req);
  authorize(can(u, "assets.create"));

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
    await recordUserChange(assetId, { user_name: null, department: null }, { user_name: (values.user_name as string) ?? null, department: (values.department as string) ?? null }, u.id, "create");
    if (values.category === LICENSE_CATEGORY) await saveLicense(assetId, data.license as Record<string, unknown>);
    await applySoftware(req, assetId, u.id);
    return assetId;
  });

  const asset = (await first<AssetRow>("SELECT * FROM assets WHERE id = ?", [id]))!;
  res.status(201).json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
});

assetRoutes.get("/assets/:uuid", async (req, res) => {
  const asset = await findVisibleAsset(req, req.params.uuid);
  res.json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
});

/** PUT/PATCH — ถ้าสถานที่/ผู้ถือครองเปลี่ยน บันทึกประวัติการโอนย้ายอัตโนมัติ (movement_reason = เหตุผล) */
async function updateAsset(req: Request, res: import("express").Response) {
  const current = await findAsset(String(req.params.uuid));
  const data = await validate(req.input, { ...assetRules(current.id), ...licenseRules(req.input, current) }, {
    locale: req.locale,
    messages: assetMessages(req),
    after: assetAfter(req, current.id),
  });
  const u = me(req);
  authorize(can(u, "assets.update"));

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
    await recordUserChange(
      current.id,
      { user_name: locked.user_name, department: locked.department },
      {
        user_name: "user_name" in changes ? (changes.user_name as string | null) : locked.user_name,
        department: "department" in changes ? (changes.department as string | null) : locked.department,
      },
      u.id,
      "edit",
    );

    // license ตามหมวดใหม่: SOFTWARE → บันทึก (ถ้าส่งมา), หมวดอื่น → ลบ (ไฟล์แนบยังเก็บไว้)
    const category = "category" in changes ? changes.category : locked.category;
    if (category === LICENSE_CATEGORY) {
      if ("license" in data) await saveLicense(current.id, data.license as Record<string, unknown>);
    } else {
      await deleteLicense(current.id);
    }
    await applySoftware(req, current.id, u.id);
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

/** ดู license key (ถอดรหัส) — ผู้จัดการสินทรัพย์ หรือฝ่าย IT; ตรวจ IP / ยืนยันรหัสผ่านซ้ำ (ถ้าเปิดใช้) + บันทึก audit ทุกครั้ง + แจ้งหัวหน้า IT (ถ้าเปิดใช้) */
assetRoutes.post("/assets/:uuid/license-key", limits.reveal, async (req, res) => {
  const asset = await findAsset(String(req.params.uuid));
  const u = me(req);
  authorize(can(u, "assets.license_key"));
  await assertCanReveal(req);
  const key = await revealKey(asset.id);
  await audit(req, { action: "asset.license_key_revealed", subjectType: "asset", subjectId: asset.id, after: { asset_tag: asset.asset_tag, name: asset.name } });
  await notifyReveal(req, "license", { id: asset.uuid, title: `${asset.asset_tag} — ${asset.name}` });
  res.json({ data: { license_key: key } });
});

const FILE_RULE = ["file", "mimes:pdf,txt,xml,zip,jpg,jpeg,png,webp,doc,docx,xls,xlsx", "max:10240"]; // ≤ 10MB
/** พรีวิวในเบราว์เซอร์ได้ (ที่เหลือดาวน์โหลด) */
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

/** POST /assets/{uuid}/files — อัปโหลดไฟล์ license (multipart files[] ≤ 10 ไฟล์ต่อครั้ง) */
assetRoutes.post("/assets/:uuid/files", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const u = me(req);
  authorize(can(u, "assets.update"));
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
  const asset = await findVisibleAsset(req, req.params.uuid);
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
  authorize(can(me(req), "assets.update"));
  await exec("DELETE FROM asset_files WHERE id = ?", [file.id]);
  await deleteStored(file.path);
  res.status(204).end();
});

async function findFile(assetId: number, id: string): Promise<AssetFileRow> {
  const row = /^\d+$/.test(id) ? await first<AssetFileRow>("SELECT * FROM asset_files WHERE id = ? AND asset_id = ?", [Number(id), assetId]) : null;
  if (!row) throw notFound();
  return row;
}

/* ---------------------------------------------------------------- ประวัติผู้ใช้งาน / ประวัติการซ่อม */

/** GET /assets/{uuid}/user-logs — การเปลี่ยน "ชื่อ-สกุลผู้ใช้งาน" / Department ล่าสุดก่อน (สูงสุด 100) */
assetRoutes.get("/assets/:uuid/user-logs", async (req, res) => {
  const asset = await findVisibleAsset(req, req.params.uuid);
  const rows = await select<{
    id: number; from_user_name: string | null; to_user_name: string | null; from_department: string | null; to_department: string | null;
    source: string; changed_at: string; by_id: number | null; by_name: string | null;
  }>(
    `SELECT l.id, l.from_user_name, l.to_user_name, l.from_department, l.to_department, l.source, l.changed_at, u.id AS by_id, u.name AS by_name
       FROM asset_user_logs l LEFT JOIN users u ON u.id = l.performed_by
      WHERE l.asset_id = ? ORDER BY l.changed_at DESC, l.id DESC LIMIT 100`,
    [asset.id],
  );
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      from_user_name: r.from_user_name,
      to_user_name: r.to_user_name,
      from_department: r.from_department,
      to_department: r.to_department,
      source: r.source,
      changed_at: iso(r.changed_at),
      performed_by: r.by_id ? { id: r.by_id, name: r.by_name } : null,
    })),
  });
});

/** GET /assets/{uuid}/repairs — ประวัติการซ่อมของสินทรัพย์นี้ ล่าสุดก่อน (สูงสุด 100) — ดู services/asset-repairs.ts */
assetRoutes.get("/assets/:uuid/repairs", async (req, res) => {
  const asset = await findVisibleAsset(req, req.params.uuid);
  res.json({ data: await repairList("(t.asset_id = ? OR (t.asset_id IS NULL AND t.asset_tag = ?))", [asset.id, asset.asset_tag], 100) });
});

/**
 * GET /repairs?search=&status=open|completed&result=&repair_method=&branch_id=&category=&from=&to=&per_page=
 * หน้ารวมประวัติการซ่อมทุกเครื่อง — เฉพาะผู้ที่เห็นสินทรัพย์ทั้งหมด (เหมือน /movements)
 * search = เลขที่ใบงาน / เลขครุภัณฑ์ / ชื่อสินทรัพย์ / ชื่ออุปกรณ์ / อาการ
 */
assetRoutes.get("/repairs", async (req, res) => {
  authorize(seesAllAssets(me(req)));
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      status: ["nullable", "in:open,completed"],
      result: ["nullable", "in:completed,cannot_complete"],
      repair_method: ["nullable", "in:in_house,external"],
      branch_id: ["nullable", "integer"],
      category: ["nullable", "string", "max:30"],
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
  if (search) {
    const like = `%${likeEscape(search)}%`;
    where.push("(t.ticket_no LIKE ? OR t.asset_tag LIKE ? OR a.name LIKE ? OR t.device_name LIKE ? OR t.symptom LIKE ?)");
    params.push(like, `${likeEscape(search)}%`, like, like, like);
  }
  if (f.status === "completed") where.push("t.status = 'completed'");
  else if (f.status === "open") where.push("t.status <> 'completed'");
  if (f.result) (where.push("t.result = ?"), params.push(f.result));
  if (f.repair_method) (where.push("t.repair_method = ?"), params.push(f.repair_method));
  if (f.branch_id) (where.push("b.id = ?"), params.push(int(f.branch_id)));
  if (f.category) (where.push("a.category = ?"), params.push(String(f.category)));
  if (f.from) (where.push("t.requested_at >= ?"), params.push(String(f.from).slice(0, 10)));
  if (f.to) {
    const end = parseDate(String(f.to).slice(0, 10))!;
    end.setUTCDate(end.getUTCDate() + 1);
    where.push("t.requested_at < ?");
    params.push(end.toISOString().slice(0, 10));
  }
  const whereSql = where.join(" AND ");
  const total = Number(await scalar(`SELECT COUNT(*) FROM ${REPAIR_FROM} WHERE ${REPAIR_BASE_WHERE} AND ${whereSql}`, params));
  const data = await repairList(whereSql, params, perPage, (page - 1) * perPage);
  res.json(paginated(req, data, total, page, perPage));
});

/* ---------------------------------------------------------------- movements ของสินทรัพย์ */

/** GET /assets/{uuid}/movements?per_page=20 — ล่าสุดก่อน */
assetRoutes.get("/assets/:uuid/movements", async (req, res) => {
  const asset = await findVisibleAsset(req, req.params.uuid);
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
  authorize(can(u, "assets.update"));

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

/**
 * GET /movements?search=&type=&location_id=&branch_id=&category=&from=&to=&per_page=
 * search = เลขครุภัณฑ์ (ขึ้นต้น) / ชื่อสินทรัพย์ / ชื่อผู้ถือครองเดิมหรือใหม่
 * type = registered / transfer (ทั้งหมด) / location (เปลี่ยนสถานที่) / custodian (เปลี่ยนผู้ถือครอง)
 */
assetRoutes.get("/movements", async (req, res) => {
  // รายงานรวมของทุกสินทรัพย์ — เฉพาะผู้ที่เห็นสินทรัพย์ทั้งหมด
  authorize(seesAllAssets(me(req)));
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      location_id: ["nullable", "integer"],
      type: ["nullable", "in:registered,transfer,location,custodian"],
      branch_id: ["nullable", "integer"],
      category: ["nullable", "string", "max:30"],
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
  if (search) {
    const like = `%${likeEscape(search)}%`;
    where.push(
      `(a.asset_tag LIKE ? OR a.name LIKE ?
        OR EXISTS (SELECT 1 FROM users cu WHERE cu.id IN (m.from_custodian_id, m.to_custodian_id) AND cu.name LIKE ?))`,
    );
    params.push(`${likeEscape(search)}%`, like, like);
  }
  if (f.branch_id) (where.push("a.branch_id = ?"), params.push(int(f.branch_id)));
  if (f.category) (where.push("a.category = ?"), params.push(String(f.category)));
  if (f.location_id) (where.push("(m.to_location_id = ? OR m.from_location_id = ?)"), params.push(int(f.location_id), int(f.location_id)));
  if (f.type === "location") where.push("m.type = 'transfer' AND NOT (m.from_location_id <=> m.to_location_id)");
  else if (f.type === "custodian") where.push("m.type = 'transfer' AND NOT (m.from_custodian_id <=> m.to_custodian_id)");
  else if (f.type) (where.push("m.type = ?"), params.push(f.type));
  if (f.from) (where.push("m.moved_at >= ?"), params.push(String(f.from).slice(0, 10)));
  if (f.to) {
    const end = parseDate(String(f.to).slice(0, 10))!;
    end.setUTCDate(end.getUTCDate() + 1);
    where.push("m.moved_at < ?");
    params.push(end.toISOString().slice(0, 10));
  }
  const whereSql = where.join(" AND ");
  // whereHas('asset') ของ Laravel ใช้ SoftDeletes scope → ค้นเฉพาะสินทรัพย์ที่ยังไม่ถูกลบ
  const searchJoin = search || f.branch_id || f.category ? "JOIN assets a ON a.id = m.asset_id AND a.deleted_at IS NULL" : "LEFT JOIN assets a ON a.id = m.asset_id";

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
