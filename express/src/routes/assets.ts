import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb, parseDate } from "../lib/time.js";
import { exists, int, regex, unique, validate, type Rules } from "../lib/validator.js";
import { me, pageParam, paginated } from "../http.js";
import { canManageAssets, isAdmin } from "../models/user.js";
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

/** โหลด location (เต็ม) + custodian แบบ $asset->load(['location', 'custodian']) */
async function withRelations(a: AssetRow) {
  const location = a.location_id
    ? await first<LocationRow>("SELECT id, code, name, type, parent_id, address, is_active FROM locations WHERE id = ? AND deleted_at IS NULL", [a.location_id])
    : null;
  const custodian = a.custodian_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [a.custodian_id]) : null;
  return { location, custodian };
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
    purchase_date: r(["nullable", "date", "before_or_equal:today"]),
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
  const rows = await select<AssetRow & { l_id: number | null; l_code: string; l_name: string; l_type: string; l_parent_id: number | null; c_id: number | null; c_name: string }>(
    `SELECT a.*, l.id AS l_id, l.code AS l_code, l.name AS l_name, l.type AS l_type, l.parent_id AS l_parent_id, c.id AS c_id, c.name AS c_name
       FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id AND l.deleted_at IS NULL
       LEFT JOIN users c ON c.id = a.custodian_id
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
    }),
  );
  res.json(paginated(req, data, total, page, perPage));
});

assetRoutes.post("/assets", async (req, res) => {
  const data = await validate(req.input, assetRules(), { locale: req.locale, messages: assetMessages(req) });
  const u = me(req);
  authorize(canManageAssets(u));

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
  const data = await validate(req.input, assetRules(current.id), { locale: req.locale, messages: assetMessages(req) });
  const u = me(req);
  authorize(canManageAssets(u));

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
  });

  const asset = (await first<AssetRow>("SELECT * FROM assets WHERE id = ?", [current.id]))!;
  res.json({ data: assetResource(asset, req.locale, await withRelations(asset)) });
}

assetRoutes.put("/assets/:uuid", updateAsset);
assetRoutes.patch("/assets/:uuid", updateAsset);

/** Soft delete — เก็บประวัติไว้เพื่อการตรวจสอบ */
assetRoutes.delete("/assets/:uuid", async (req, res) => {
  const asset = await findAsset(req.params.uuid);
  authorize(isAdmin(me(req)));
  await update("assets", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [asset.id]);
  res.status(204).end();
});

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
  authorize(canManageAssets(u));

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
