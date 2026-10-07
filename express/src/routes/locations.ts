import { Router, type Request } from "express";
import { first, insert, scalar, select, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, exists, int, regex, unique, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { locationResource, type LocationRow } from "../resources.js";
import { forgetLaravelCache } from "../services/settings.js";

/** LocationController — สถานที่แบบลำดับชั้น */
export const locationRoutes = Router();

const TYPES = ["site", "building", "floor", "room", "warehouse"];
const CODE = /^[A-Za-z0-9\-_/]+$/;

/** นับสินทรัพย์/สถานที่ย่อยที่ยังไม่ถูกลบ (withCount ใช้ SoftDeletes scope) */
const WITH_COUNTS = `l.*,
  (SELECT COUNT(*) FROM assets a WHERE a.location_id = l.id AND a.deleted_at IS NULL) AS assets_count,
  (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id AND c.deleted_at IS NULL) AS children_count`;

async function findWithCounts(id: number): Promise<LocationRow> {
  const loc = await first<LocationRow>(`SELECT ${WITH_COUNTS} FROM locations l WHERE l.id = ? AND l.deleted_at IS NULL`, [id]);
  if (!loc) throw notFound();
  return loc;
}

/** id จาก URL: ไม่ใช่ตัวเลข = ไม่พบ (route model binding) */
const routeId = (req: Request) => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN);

async function validated(req: Request, current: LocationRow | null) {
  const s = current ? ["sometimes"] : [];
  return validate(
    req.input,
    {
      code: [...s, "required", "string", "max:50", regex(CODE), unique("locations", "code", current?.id)],
      name: [...s, "required", "string", "max:255"],
      type: [...s, "required", `in:${TYPES.join(",")}`],
      parent_id: ["sometimes", "nullable", "integer", exists("locations", "id", "deleted_at IS NULL")],
      address: ["sometimes", "nullable", "string", "max:2000"],
      is_active: ["sometimes", "boolean"],
    },
    {
      locale: req.locale,
      messages: { "code.regex": trans(req.locale, "eam.location.code_format") },
      // ป้องกันโครงสร้างวนซ้ำ: สถานที่แม่ต้องไม่ใช่ตัวเองหรือสถานที่ย่อยของตัวเอง
      after: async ({ errors }) => {
        const parentId = req.input.parent_id;
        if (!current || !parentId || errors.has("parent_id")) return;
        let id = Number(parentId);
        for (let seen = 0; id && seen < 50; seen++) {
          if (id === current.id) {
            errors.add("parent_id", trans(req.locale, "eam.location.invalid_parent"));
            return;
          }
          id = Number(await scalar("SELECT parent_id FROM locations WHERE id = ?", [id])) || 0;
        }
      },
    },
  );
}

function columns(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ["code", "name", "type", "parent_id", "address", "is_active"]) {
    if (!(key in data)) continue;
    const v = data[key];
    out[key] = key === "parent_id" ? int(v) : key === "is_active" ? bool(v) : v;
  }
  return out;
}

/**
 * GET /locations — สถานที่ที่ใช้งานอยู่ (dropdown/filter)
 * GET /locations?include_inactive=1 — ทั้งหมด + จำนวนสินทรัพย์/สถานที่ย่อย (admin/manager)
 */
locationRoutes.get("/locations", async (req, res) => {
  if (bool(req.query.include_inactive)) {
    authorize(can(me(req), "locations.manage"));
    const all = await select<LocationRow>(`SELECT ${WITH_COUNTS} FROM locations l WHERE l.deleted_at IS NULL ORDER BY l.code`);
    return res.json({ data: all.map(locationResource) });
  }
  const active = await select<LocationRow>(
    "SELECT id, code, name, type, parent_id, address, is_active FROM locations WHERE is_active = true AND deleted_at IS NULL ORDER BY name",
  );
  res.json({ data: active.map(locationResource) });
});

locationRoutes.get("/locations/:id", async (req, res) => {
  res.json({ data: locationResource(await findWithCounts(routeId(req))) });
});

/** รหัสสถานที่ถัดไปแบบอัตโนมัติ LOC-0001, LOC-0002, … (นับรวมที่ถูกลบ เพราะรหัสห้ามซ้ำ) */
async function nextLocationCode() {
  const rows = await select<{ code: string }>("SELECT code FROM locations WHERE code LIKE 'LOC-%'");
  const max = rows.reduce((m, r) => Math.max(m, /^LOC-(\d+)$/.test(r.code) ? Number(r.code.slice(4)) : 0), 0);
  return `LOC-${String(max + 1).padStart(4, "0")}`;
}

locationRoutes.post("/locations", async (req, res) => {
  // เพิ่มด่วนจากฟอร์มสินทรัพย์ (พิมพ์แค่ชื่อ): ไม่ส่งรหัส → สร้างให้, ไม่ส่งประเภท → ห้อง (room) — แก้ภายหลังได้ที่หน้าสถานที่
  if (req.input.code == null) req.input.code = await nextLocationCode();
  if (req.input.type == null) req.input.type = "room";
  const data = await validated(req, null);
  authorize(can(me(req), "locations.manage"));
  const now = nowDb();
  const id = await insert("locations", { ...columns(data), created_at: now, updated_at: now });
  await forgetLaravelCache("locations:active");
  res.status(201).json({ data: locationResource(await findWithCounts(id)) });
});

async function updateLocation(req: Request, res: import("express").Response) {
  const current = await findWithCounts(routeId(req));
  const data = await validated(req, current);
  authorize(can(me(req), "locations.manage"));
  await update("locations", { ...columns(data), updated_at: nowDb() }, "id = ?", [current.id]);
  await forgetLaravelCache("locations:active");
  res.json({ data: locationResource(await findWithCounts(current.id)) });
}

locationRoutes.put("/locations/:id", updateLocation);
locationRoutes.patch("/locations/:id", updateLocation);

/** Soft delete — ไม่อนุญาตถ้ายังมีสถานที่ย่อยหรือสินทรัพย์อยู่ */
locationRoutes.delete("/locations/:id", async (req, res) => {
  const loc = await findWithCounts(routeId(req));
  authorize(can(me(req), "locations.delete"));
  if (Number(loc.children_count) > 0) throw ValidationError.withMessages({ location: trans(req.locale, "eam.location.has_children") });
  if (Number(loc.assets_count) > 0) throw ValidationError.withMessages({ location: trans(req.locale, "eam.location.has_assets") });
  await update("locations", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [loc.id]);
  await forgetLaravelCache("locations:active");
  res.status(204).end();
});
