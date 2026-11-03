import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import { addDays, dateOnly, fromDbDate, iso, localToday, nowDb, parseDate, toDbDate } from "../lib/time.js";
import { bool, exists, int, regex, unique, validate, type ErrorBag, type Rules } from "../lib/validator.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { me, pageParam, paginated } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { loadFiles, type AssetFileRow } from "../services/asset-files.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";
import {
  assetResource, MOVEMENT_JOINS, MOVEMENT_SELECT, movementResource,
  type AssetRow, type LocationRow, type MovementJoinedRow,
} from "../resources.js";
import { recordIfMoved, recordRegistration, recordUserChange } from "../services/asset-movements.js";
import { REPAIR_BASE_WHERE, REPAIR_FROM, repairList } from "../services/asset-repairs.js";
import { COMPUTER_CATEGORY, COMPUTER_DATE_FIELDS, COMPUTER_TEXT_FIELDS, buildExport, buildTemplate, importRows, parseWorkbook } from "../services/asset-import.js";
import { audit } from "../services/audit.js";
import { loadSoftware, softwareErrors, softwareOptions, syncSoftware, SOFTWARE_SLOTS } from "../services/asset-software.js";

/** AssetController + AssetMovementController + MovementController */
export const assetRoutes = Router();

const STATUSES = ["active", "in_storage", "in_repair", "lost", "disposed"];
const LEGACY_LICENSE_CATEGORY = "SOFTWARE";
const SORTABLE = ["asset_tag", "name", "category", "status", "purchase_date", "created_at"];
const TAG = /^[A-Za-z0-9\-_/]+$/;
const FILLABLE = [
  "asset_tag", "name", "category", "brand", "model", "serial_number", "status", "location_id",
  "custodian_id", "purchase_date", "purchase_cost", "warranty_expires_at", "notes", "branch_id", "is_loanable", "is_shared",
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
/** เปิดเมนูสินทรัพย์ได้ — assets.view = เฉพาะที่ตัวเองถือครอง (ผู้ใช้ทั่วไปไม่มีเป็นค่าตั้งต้น) */
const seesAssets = (u: UserRow) => seesAllAssets(u) || can(u, "assets.view");

/** สินทรัพย์ "ของฉัน": เป็นผู้ถือครอง หรือชื่อผู้ใช้งาน (ทะเบียนคอมพิวเตอร์ — ข้อความจาก Excel) ตรงกับชื่อตัวเอง */
export const OWN_SQL = "(a.custodian_id = ? OR (a.user_name IS NOT NULL AND LOWER(TRIM(a.user_name)) = LOWER(TRIM(?))))";
const isOwn = (u: UserRow, a: AssetRow) =>
  Number(a.custodian_id) === u.id || (a.user_name !== null && a.user_name.trim().toLowerCase() === u.name.trim().toLowerCase());

/** findAsset + ตรวจว่าผู้ใช้เห็นได้ (ของคนอื่น = ไม่พบ ไม่บอกว่ามีอยู่) */
async function findVisibleAsset(req: Request, uuid: string): Promise<AssetRow> {
  const asset = await findAsset(uuid);
  const u = me(req);
  if (!seesAllAssets(u) && (!seesAssets(u) || !isOwn(u, asset))) throw notFound();
  return asset;
}

/**
 * ผู้ถือครอง = ผู้ใช้งาน: มีผู้ถือครอง → "ชื่อ-สกุลผู้ใช้งาน" = ชื่อของผู้ใช้คนนั้นเสมอ
 * (ข้อความ user_name อิสระใช้เฉพาะเมื่อยังไม่มีผู้ถือครอง เช่น นำเข้าจาก Excel แล้วยังไม่ผูกผู้ใช้)
 */
async function holderName(custodianId: unknown): Promise<string | null> {
  const id = int(custodianId);
  return id ? ((await scalar<string>("SELECT name FROM users WHERE id = ?", [id])) ?? null) : null;
}

/** ชื่อผู้ใช้งานของสินทรัพย์ส่วนกลาง — เก็บใน user_name เพื่อให้รายการ / ค้นหา / ประวัติผู้ใช้งานแสดงตามเดิม */
const SHARED_HOLDER = "ส่วนกลาง";

/**
 * ผู้ถือครองส่วนกลาง (ถือครองโดยสาขา/แผนก): ติ๊กแล้วไม่มีผู้ถือครองที่เป็นผู้ใช้ และต้องมีสาขา
 * ส่งผู้ถือครองมาโดยไม่ส่ง is_shared = เลิกเป็นส่วนกลาง; เลิกแล้วไม่มีผู้ถือครอง = ล้างชื่อผู้ใช้งาน
 */
function applyShared(values: Record<string, unknown>, current: AssetRow | null, locale: Locale): void {
  const was = Boolean(current?.is_shared);
  const shared = "is_shared" in values ? Boolean(values.is_shared) : was && !("custodian_id" in values && values.custodian_id);
  if (shared) {
    const branch = "branch_id" in values ? values.branch_id : current?.branch_id;
    if (!branch) throw ValidationError.withMessages({ branch_id: trans(locale, "eam.validation.asset_shared_branch") });
    values.custodian_id = null;
    values.user_name = SHARED_HOLDER;
  } else if (was && !values.custodian_id) {
    values.user_name = null;
  }
  if ("is_shared" in values || shared !== was) values.is_shared = shared;
}

/** โหลด location (เต็ม) + custodian + ไฟล์ แบบ $asset->load([...]) */
async function withRelations(a: AssetRow) {
  const location = a.location_id
    ? await first<LocationRow>("SELECT id, code, name, type, parent_id, address, is_active FROM locations WHERE id = ? AND deleted_at IS NULL", [a.location_id])
    : null;
  const custodian = a.custodian_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [a.custodian_id]) : null;
  const branch = a.branch_id ? await first<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = ?", [a.branch_id]) : null;
  return { location, custodian, branch, files: await loadFiles(a.id), software: await loadSoftware(a.id) };
}

/**
 * เลขที่ทรัพย์สินต้องไม่ซ้ำรายการอื่น (คอมพิวเตอร์เก็บที่ cpu_tag, หมวดอื่นเก็บที่ asset_tag) — ใบแจ้งซ่อมจับคู่กับเครื่องด้วยเลขนี้
 * ตรวจเฉพาะเมื่อเลขเปลี่ยน ไม่ให้ข้อมูลเดิมขวางการแก้ช่องอื่น
 */
async function assetNumberAfter(req: Request, currentId: number | undefined, { data, errors }: { data: Record<string, unknown>; errors: ErrorBag }) {
  const current = currentId ? await first<Pick<AssetRow, "asset_tag" | "cpu_tag" | "category">>("SELECT asset_tag, cpu_tag, category FROM assets WHERE id = ?", [currentId]) : null;
  const category = "category" in data ? data.category : current?.category;
  const key = category === COMPUTER_CATEGORY ? "cpu_tag" : "asset_tag";
  if (!(key in data) || errors.has(key)) return;
  const no = String(data[key] ?? "").trim();
  if (!no || no === String(current?.[key] ?? "").trim()) return;
  const taken = await scalar("SELECT 1 FROM assets WHERE deleted_at IS NULL AND (asset_tag = ? OR cpu_tag = ?) AND id <> ? LIMIT 1", [no, no, currentId ?? 0]);
  if (taken !== null && taken !== undefined) errors.add(key, trans(req.locale, "eam.validation.asset_no_duplicate"));
}

const assetAfter = (req: Request, currentId?: number) => async (ctx: { data: Record<string, unknown>; errors: ErrorBag }) => {
  // License แยกตารางแล้ว (POST /licenses) — ไม่รับหมวดเดิม
  if (ctx.data.category === LEGACY_LICENSE_CATEGORY) ctx.errors.add("category", trans(req.locale, "eam.license.software_moved"));
  await assetNumberAfter(req, currentId, ctx);
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
    // เป็นเครื่องสำหรับยืม → แสดงในหน้า ยืมโน้ตบุ๊ก
    is_loanable: ["sometimes", "boolean"],
    // ผู้ถือครองส่วนกลาง (applyShared)
    is_shared: ["sometimes", "boolean"],
    branch_id: r(["nullable", "integer", exists("branches", "id", "deleted_at IS NULL")]),
    // ข้อมูลเครื่องคอมพิวเตอร์ (ใช้กับหมวด COMPUTER — หมวดอื่นส่งมาได้แต่ฟอร์มไม่แสดง)
    ...Object.fromEntries(Object.entries(COMPUTER_TEXT_FIELDS).map(([k, max]) => [k, r(["nullable", "string", `max:${max}`])])),
    ...Object.fromEntries(COMPUTER_DATE_FIELDS.map((k) => [k, r(["nullable", "date"])])),
    ...(ignoreId ? { movement_reason: ["sometimes", "nullable", "string", "max:1000"] } : {}),
  };
}

const assetMessages = (req: Request) => ({
  // หมวดคอมพิวเตอร์: asset_tag = Host Name
  "asset_tag.regex": trans(req.locale, req.input.category === COMPUTER_CATEGORY ? "eam.validation.asset_host_regex" : "eam.validation.asset_tag_regex"),
  "asset_tag.unique": trans(req.locale, req.input.category === COMPUTER_CATEGORY ? "eam.validation.asset_host_unique" : "eam.validation.asset_tag_unique"),
  "purchase_date.before_or_equal": trans(req.locale, "eam.validation.purchase_date_future"),
});

/** ค่าจาก input → ค่าที่เก็บใน DB (ตาม cast ของ model) */
function columnValue(key: string, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (key === "location_id" || key === "custodian_id" || key === "branch_id") return int(v);
  if ((COMPUTER_DATE_FIELDS as readonly string[]).includes(key)) return String(v).slice(0, 10);
  if (key === "purchase_date" || key === "warranty_expires_at") return String(v).slice(0, 10);
  if (key === "purchase_cost") return Number(v).toFixed(2);
  if (key === "is_loanable" || key === "is_shared") return bool(v);
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
    // เลขที่ทรัพย์สิน cpu_tag (คอมพิวเตอร์) ค้นได้ด้วย — asset_tag (Host Name) / serial ใช้ prefix match, ชื่อ/ยี่ห้อ/รุ่น/ผู้ใช้งาน/IP ค้นหาบางส่วนของคำ
    where.push("(a.asset_tag LIKE ? OR a.cpu_tag LIKE ? OR a.serial_number LIKE ? OR a.name LIKE ? OR a.brand LIKE ? OR a.model LIKE ? OR a.user_name LIKE ? OR a.ip_address LIKE ?)");
    params.push(`${esc}%`, `${esc}%`, `${esc}%`, `%${esc}%`, `%${esc}%`, `%${esc}%`, `%${esc}%`, `${esc}%`);
  }
  if (f.status) (where.push("a.status = ?"), params.push(f.status));
  // License ซอฟต์แวร์ (หมวด SOFTWARE) แยกไปเมนู /licenses — ไม่ขึ้นในรายการสินทรัพย์ เว้นแต่ขอหมวดนี้ตรงๆ
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
  authorize(seesAssets(me(req)));
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
      b_name: string | null;
    }
  >(
    `SELECT a.*, l.id AS l_id, l.code AS l_code, l.name AS l_name, l.type AS l_type, l.parent_id AS l_parent_id, c.id AS c_id, c.name AS c_name, br.name AS b_name
       FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id AND l.deleted_at IS NULL
       LEFT JOIN users c ON c.id = a.custodian_id
       LEFT JOIN branches br ON br.id = a.branch_id
      WHERE ${whereSql}
      ORDER BY a."${column}" ${dir}, a.id ${dir}
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );

  const data = rows.map((r) =>
    assetResource(r, req.locale, {
      // index โหลด location เฉพาะ id,code,name,type,parent_id
      location: r.l_id ? { id: r.l_id, code: r.l_code, name: r.l_name, type: r.l_type, parent_id: r.l_parent_id } : null,
      custodian: r.c_id ? { id: r.c_id, name: r.c_name } : null,
      branch: r.branch_id && r.b_name ? { id: r.branch_id, name: r.b_name } : null,
    }),
  );
  res.json(paginated(req, data, total, page, perPage));
});

/**
 * GET /assets/missing — "สินทรัพย์ที่ต้องเพิ่ม": เลขทรัพย์สินที่ผู้แจ้งพิมพ์ในใบแจ้งซ่อม แต่ไม่พบในระบบ
 * (ไม่ตรง asset_tag / เลขที่ทรัพย์สิน cpu_tag / เลขที่ทรัพย์สิน (เดิม) monitor_tag ของสินทรัพย์ใด) — 1 แถวต่อเลข + ใบล่าสุด
 * เพิ่มสินทรัพย์ที่มีเลขนั้นแล้ว = หายจากรายการเอง; ผู้เพิ่มสินทรัพย์ได้ (assets.create) — ต้องประกาศก่อน /assets/:uuid
 */
/** เลขทรัพย์สินในใบแจ้งซ่อมที่ไม่พบในระบบ (เงื่อนไขเดียวกับ GET /assets/missing) */
const MISSING_WHERE = `${REPAIR_BASE_WHERE} AND t.asset_id IS NULL AND t.asset_tag IS NOT NULL AND TRIM(t.asset_tag) <> ''
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.deleted_at IS NULL
                    AND (a.asset_tag = TRIM(t.asset_tag) OR a.cpu_tag = TRIM(t.asset_tag) OR a.monitor_tag = TRIM(t.asset_tag)))`;

/** ตัวเลขเมนู /assets + แท็บ "สินทรัพย์ที่ต้องเพิ่ม" (ผู้เพิ่มสินทรัพย์ได้) */
export async function missingAssetCount(u: UserRow): Promise<number> {
  if (!can(u, "assets.create")) return 0;
  return Number(await scalar(`SELECT COUNT(DISTINCT TRIM(t.asset_tag)) FROM it_tickets t WHERE ${MISSING_WHERE}`));
}

/**
 * ผูกใบแจ้งซ่อมที่พิมพ์เลขนี้เข้ากับสินทรัพย์ (เขียน it_tickets.asset_id) — เลขในใบอาจไม่ตรงเลขจริงของเครื่อง เช่น ผู้แจ้งพิมพ์ผิด
 * ไม่แก้เลขที่ผู้แจ้งพิมพ์ — ใบที่ผูกแล้วขึ้นประวัติซ่อมของเครื่อง และหายจาก "สินทรัพย์ที่ต้องเพิ่ม"
 */
async function linkTicketsToAsset(req: Request, assetNo: string, assetId: number): Promise<number> {
  const { rowCount } = await exec(
    `UPDATE it_tickets t SET t.asset_id = ?, t.updated_at = ? WHERE ${REPAIR_BASE_WHERE} AND t.asset_id IS NULL AND TRIM(t.asset_tag) = ?`,
    [assetId, nowDb(), assetNo],
  );
  if (rowCount) await audit(req, { action: "asset.tickets_linked", subjectType: "asset", subjectId: assetId, after: { asset_no: assetNo, tickets: rowCount } });
  return rowCount;
}

/** POST /assets/missing/link { asset_no, asset_tag } — เลขในใบไม่ตรงสินทรัพย์ที่มีอยู่แล้ว: เลือกสินทรัพย์ให้เอง */
assetRoutes.post("/assets/missing/link", async (req, res) => {
  authorize(can(me(req), "assets.update"));
  const data = await validate(
    req.input,
    {
      asset_no: ["required", "string", "max:100"],
      asset_tag: ["required", "string", "max:50", exists("assets", "asset_tag", "deleted_at IS NULL")],
    },
    { locale: req.locale },
  );
  const assetId = Number(await scalar("SELECT id FROM assets WHERE asset_tag = ? AND deleted_at IS NULL", [data.asset_tag]));
  const tickets = await linkTicketsToAsset(req, String(data.asset_no).trim(), assetId);
  if (!tickets) throw ValidationError.withMessages({ asset_no: trans(req.locale, "eam.validation.asset_no_no_tickets") });
  res.json({ data: { tickets } });
});

assetRoutes.get("/assets/missing", async (req, res) => {
  authorize(can(me(req), "assets.create"));
  const rows = await select<{
    tag: string; tickets: number; uuid: string; ticket_no: string; requested_at: string; device_name: string | null; symptom: string | null;
    r_name: string | null; b_name: string | null;
  }>(
    `SELECT x.tag, x.tickets, x.uuid, x.ticket_no, x.requested_at, x.device_name, x.symptom, x.r_name, x.b_name
       FROM (SELECT TRIM(t.asset_tag) AS tag, t.uuid, t.ticket_no, t.requested_at, t.device_name, t.symptom, u.name AS r_name, b.name AS b_name,
                    COUNT(*) OVER (PARTITION BY TRIM(t.asset_tag)) AS tickets,
                    ROW_NUMBER() OVER (PARTITION BY TRIM(t.asset_tag) ORDER BY t.requested_at DESC, t.id DESC) AS rn
               FROM it_tickets t
               LEFT JOIN users u ON u.id = t.requester_id
               LEFT JOIN branches b ON b.id = t.branch_id
              WHERE ${MISSING_WHERE}) x
      WHERE x.rn = 1
      ORDER BY x.requested_at DESC
      LIMIT 500`,
  );
  res.json({
    data: rows.map((r) => ({
      asset_no: r.tag,
      tickets: Number(r.tickets),
      device_name: r.device_name,
      last_ticket: { id: r.uuid, ticket_no: r.ticket_no, requested_at: iso(r.requested_at), symptom: r.symptom, requester: r.r_name, branch: r.b_name },
    })),
  });
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
  const params: unknown[] = [[COMPUTER_CATEGORY]];
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
  // source_asset_no = เพิ่มจากแท็บ "สินทรัพย์ที่ต้องเพิ่ม": เลขในใบแจ้งซ่อมที่จะผูกกับสินทรัพย์นี้
  const data = await validate(req.input, { ...assetRules(), source_asset_no: ["sometimes", "nullable", "string", "max:100"] }, { locale: req.locale, messages: assetMessages(req), after: assetAfter(req) });
  const u = me(req);
  authorize(can(u, "assets.create"));

  const id = await transaction(async () => {
    const now = nowDb();
    const values: Record<string, unknown> = {};
    for (const key of FILLABLE) if (key in data) values[key] = columnValue(key, data[key]);
    applyShared(values, null, req.locale);
    const holder = await holderName(values.custodian_id);
    if (holder) values.user_name = holder;
    const assetId = await insert("assets", {
      uuid: randomUUID(),
      status: "active",
      ...values,
      created_by: u.id,
      updated_by: u.id,
      created_at: now,
      updated_at: now,
    });
    await recordRegistration(assetId, (values.location_id as number) ?? null, (values.custodian_id as number) ?? null, u.id, (values.branch_id as number) ?? null);
    await recordUserChange(assetId, { user_name: null, department: null }, { user_name: (values.user_name as string) ?? null, department: (values.department as string) ?? null }, u.id, "create");
    await applySoftware(req, assetId, u.id);
    if (data.source_asset_no) await linkTicketsToAsset(req, String(data.source_asset_no).trim(), assetId);
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
  const data = await validate(req.input, assetRules(current.id), {
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
    applyShared(changes, locked, req.locale);
    const holder = await holderName("custodian_id" in changes ? changes.custodian_id : locked.custodian_id);
    if (holder) changes.user_name = holder;
    await update("assets", { ...changes, updated_by: u.id, updated_at: nowDb() }, "id = ?", [current.id]);

    const to = {
      location: "location_id" in changes ? (changes.location_id as number | null) : locked.location_id,
      custodian: "custodian_id" in changes ? (changes.custodian_id as number | null) : locked.custodian_id,
      branch: "branch_id" in changes ? (changes.branch_id as number | null) : locked.branch_id,
    };
    await recordIfMoved(
      current.id,
      { location: locked.location_id, custodian: locked.custodian_id, branch: locked.branch_id },
      to,
      u.id,
      (data.movement_reason as string) ?? null,
    );
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

/* ---------------------------------------------------------------- ไฟล์แนบ */

const FILE_RULE = ["file", "mimes:pdf,txt,xml,zip,jpg,jpeg,png,webp,doc,docx,xls,xlsx", "max:10240"]; // ≤ 10MB
/** พรีวิวในเบราว์เซอร์ได้ (ที่เหลือดาวน์โหลด) */
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

/** POST /assets/{uuid}/files — อัปโหลดไฟล์ (multipart files[] ≤ 10 ไฟล์ต่อครั้ง) */
assetRoutes.post("/assets/:uuid/files", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  const u = me(req);
  authorize(can(u, "assets.update"));
  const data = await validate(req.input, { files: ["required", "array", "min:1", "max:10"], "files.*": FILE_RULE }, { locale: req.locale });

  const uploads = Object.values(data.files as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const now = nowDb();
  for (const file of uploads) {
    const stored = await storeUploadIn(`assets/${asset.uuid}/files`, file);
    await insert("asset_files", { asset_id: asset.id, ...stored, uploaded_by: u.id, created_at: now, updated_at: now });
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
  // ใบที่ยังไม่ผูก asset_id: เลขที่พิมพ์ตรงรหัสสินทรัพย์ / เลขที่ทรัพย์สิน / เลขที่ทรัพย์สิน (เดิม) และเลือกเครื่องนี้ (a.id — กันเลขซ้ำหลายเครื่อง)
  const numbers = [asset.asset_tag, asset.cpu_tag, asset.monitor_tag].filter((v): v is string => Boolean(v && v.trim()));
  res.json({ data: await repairList("(t.asset_id = ? OR (t.asset_id IS NULL AND t.asset_tag IN (?) AND a.id = ?))", [asset.id, numbers, asset.id], 100) });
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
    // รหัสสินทรัพย์ที่ผูก (a.asset_tag) — ลิงก์ "ดูรายละเอียดทั้งหมด" จากหน้ารายละเอียดสินทรัพย์ค้นด้วยค่านี้
    where.push("(t.ticket_no LIKE ? OR t.asset_tag LIKE ? OR a.asset_tag LIKE ? OR a.name LIKE ? OR t.device_name LIKE ? OR t.symptom LIKE ?)");
    params.push(like, `${likeEscape(search)}%`, `${likeEscape(search)}%`, like, like, like);
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
      branch_id: ["sometimes", "nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      moved_at: ["nullable", "date", "before_or_equal:now"],
      reason: ["nullable", "string", "max:1000"],
    },
    {
      locale: req.locale,
      messages: { "moved_at.before_or_equal": trans(req.locale, "eam.movement.future_date") },
      after: ({ errors }) => {
        if (!("location_id" in input) && !("custodian_id" in input) && !("branch_id" in input)) {
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
      branch: "branch_id" in data ? int(data.branch_id) : locked.branch_id,
    };
    const movedAt = data.moved_at ? parseDate(data.moved_at) : null;
    const id = await recordIfMoved(
      current.id,
      { location: locked.location_id, custodian: locked.custodian_id, branch: locked.branch_id },
      to,
      u.id,
      (data.reason as string) ?? null,
      movedAt,
    );
    if (!id) throw ValidationError.withMessages({ location_id: trans(req.locale, "eam.movement.no_change") });

    // ผู้ถือครองใหม่ = ผู้ใช้งาน (+ ประวัติผู้ใช้งาน)
    const holder = await holderName(to.custodian);
    const userName = holder ?? (to.custodian === locked.custodian_id ? locked.user_name : null);
    await update(
      "assets",
      // โอนให้ผู้ใช้ = เลิกเป็นส่วนกลาง
      { location_id: to.location, custodian_id: to.custodian, branch_id: to.branch, user_name: userName, ...(holder ? { is_shared: false } : {}), updated_by: u.id, updated_at: nowDb() },
      "id = ?",
      [current.id],
    );
    await recordUserChange(current.id, { user_name: locked.user_name, department: locked.department }, { user_name: userName, department: locked.department }, u.id, "edit");
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
  // รายงานรวมของทุกสินทรัพย์ — สิทธิ์ movements.view
  authorize(can(me(req), "movements.view"));
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
