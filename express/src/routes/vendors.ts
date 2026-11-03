import { Router, type Request } from "express";
import { first, insert, scalar, select, update } from "../db.js";
import { me } from "../http.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, custom, validate } from "../lib/validator.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";

/**
 * ข้อมูลหลัก → Vendor (vendors.manage) — ฟอร์มส่งซ่อมเลือกผ่าน GET /repair-orders/form-options
 * ลบ = soft delete เฉพาะที่ยังไม่มีรายการส่งซ่อม — มีแล้วให้ปิดใช้งาน
 */
export const vendorRoutes = Router();

interface VendorRow {
  id: number;
  name: string;
  tax_id: string | null;
  address: string;
  contact_name: string;
  contact_phone: string;
  vendor_type: string;
  is_active: boolean | number;
  repairs_count: number | string;
}

const SELECT = "v.*, (SELECT COUNT(*) FROM repair_orders r WHERE r.vendor_id = v.id) AS repairs_count";

const json = (v: VendorRow) => ({
  id: Number(v.id),
  name: v.name,
  tax_id: v.tax_id,
  address: v.address,
  contact_name: v.contact_name,
  contact_phone: v.contact_phone,
  vendor_type: v.vendor_type,
  is_active: Boolean(v.is_active),
  repairs_count: Number(v.repairs_count),
});

const load = async (id: number) => {
  const row = Number.isNaN(id) ? null : await first<VendorRow>(`SELECT ${SELECT} FROM vendors v WHERE v.id = ? AND v.deleted_at IS NULL`, [id]);
  if (!row) throw notFound();
  return row;
};
const find = (req: Request) => load(/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN);

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
      is_active: ["sometimes", "boolean"],
    },
    { locale: req.locale },
  );

const columns = (d: Record<string, unknown>) => ({
  name: String(d.name).trim(),
  tax_id: String(d.tax_id ?? "").trim() || null,
  address: String(d.address).trim(),
  contact_name: String(d.contact_name).trim(),
  contact_phone: String(d.contact_phone).trim(),
  vendor_type: String(d.vendor_type).trim(),
  ...("is_active" in d ? { is_active: bool(d.is_active) } : {}),
});

vendorRoutes.get("/vendors", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const rows = await select<VendorRow>(`SELECT ${SELECT} FROM vendors v WHERE v.deleted_at IS NULL ORDER BY v.is_active DESC, v.name`);
  res.json({ data: rows.map(json) });
});

vendorRoutes.get("/vendors/:id", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  res.json({ data: json(await find(req)) });
});

vendorRoutes.post("/vendors", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const data = await input(req, null);
  const now = nowDb();
  const id = await insert("vendors", { ...columns(data), created_at: now, updated_at: now });
  const row = await load(id);
  await audit(req, { action: "vendor.created", subjectType: "vendor", subjectId: id, after: json(row) });
  res.status(201).json({ data: json(row) });
});

vendorRoutes.put("/vendors/:id", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const current = await find(req);
  const data = await input(req, current);
  await update("vendors", { ...columns(data), updated_at: nowDb() }, "id = ?", [current.id]);
  const row = await load(Number(current.id));
  await audit(req, { action: "vendor.updated", subjectType: "vendor", subjectId: current.id, before: json(current), after: json(row) });
  res.json({ data: json(row) });
});

vendorRoutes.delete("/vendors/:id", async (req, res) => {
  authorize(can(me(req), "vendors.manage"));
  const current = await find(req);
  if (Number(current.repairs_count) > 0) throw ValidationError.withMessages({ vendor: trans(req.locale, "eam.vendor.in_use", { count: Number(current.repairs_count) }) });
  const now = nowDb();
  await update("vendors", { deleted_at: now, updated_at: now }, "id = ?", [current.id]);
  await audit(req, { action: "vendor.deleted", subjectType: "vendor", subjectId: current.id, before: json(current) });
  res.status(204).end();
});
