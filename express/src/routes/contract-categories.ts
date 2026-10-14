import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, custom, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { isBuiltinName } from "../services/categories.js";

/**
 * ข้อมูลหลัก: หมวดหมู่สัญญา vendor (สิทธิ์ contracts.categories)
 *   GET    /contract-categories                    ที่เปิดใช้งาน (ฟอร์ม/ตัวกรองสัญญา) · ?include_inactive=1 = ทั้งหมด + จำนวนสัญญา
 *   POST   /contract-categories                    { name, is_active?, sort_order? }
 *   PUT|PATCH /contract-categories/{id}
 *   DELETE /contract-categories/{id}               ลบได้เมื่อไม่มีสัญญาใช้อยู่ — มิฉะนั้นให้ปิดใช้งาน
 */
export const contractCategoryRoutes = Router();

interface CategoryRow {
  id: number;
  name: string;
  /** หมวดตั้งต้น (key เดียวกับคลังบัญชี) — NULL = เพิ่มเอง */
  builtin_key: string | null;
  is_active: boolean | number;
  sort_order: number;
  contracts_count?: number | string;
}

const json = (r: CategoryRow) => ({
  id: Number(r.id),
  name: r.name,
  key: r.builtin_key ?? null,
  is_active: Boolean(r.is_active),
  sort_order: Number(r.sort_order),
  ...(r.contracts_count !== undefined ? { contracts_count: Number(r.contracts_count) } : {}),
});

const USED = "(SELECT COUNT(*) FROM contracts c WHERE c.category_id = o.id AND c.deleted_at IS NULL)";
const manage = (req: Request) => authorize(can(me(req), "contracts.categories"));

async function find(req: Request): Promise<CategoryRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<CategoryRow>(`SELECT o.*, ${USED} AS contracts_count FROM contract_categories o WHERE o.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

const input = (req: Request, current: CategoryRow | null) =>
  validate(
    req.input,
    {
      name: [
        current ? "sometimes" : "required",
        "string",
        "max:100",
        custom(async (v) => {
          if (isBuiltinName(String(v))) return false;
          const dup = await scalar(`SELECT 1 FROM contract_categories WHERE LOWER(name) = LOWER(?)${current ? " AND id <> ?" : ""}`, current ? [String(v).trim(), current.id] : [String(v).trim()]);
          return dup === null;
        }, trans(req.locale, "eam.org.duplicate")),
      ],
      is_active: ["sometimes", "boolean"],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
    },
    { locale: req.locale },
  );

contractCategoryRoutes.get("/contract-categories", async (req, res) => {
  if (bool(req.query.include_inactive)) {
    manage(req);
    const rows = await select<CategoryRow>(`SELECT o.*, ${USED} AS contracts_count FROM contract_categories o ORDER BY o.builtin_key IS NULL, o.sort_order, o.name`);
    return res.json({ data: rows.map(json) });
  }
  const rows = await select<CategoryRow>("SELECT * FROM contract_categories o WHERE o.is_active = true ORDER BY o.builtin_key IS NULL, o.sort_order, o.name");
  res.json({ data: rows.map(json) });
});

contractCategoryRoutes.post("/contract-categories", async (req, res) => {
  const u = me(req);
  const full = can(u, "contracts.categories");
  // ผู้จัดการหมวดหมู่ หรือ "เพิ่มด่วน" จากฟอร์มสัญญา (ผู้ที่เพิ่ม/แก้สัญญาได้)
  authorize(full || can(u, "contracts.create") || can(u, "contracts.update"));
  const data = await input(req, null);
  const now = nowDb();
  const id = await insert("contract_categories", {
    name: String(data.name).trim(),
    is_active: "is_active" in data && full ? bool(data.is_active) : true,
    sort_order: full ? (data.sort_order ?? 0) : 0,
    created_at: now,
    updated_at: now,
  });
  const row = await first<CategoryRow>(`SELECT o.*, ${USED} AS contracts_count FROM contract_categories o WHERE o.id = ?`, [id]);
  await audit(req, { action: "contract_category.created", subjectType: "contract_category", subjectId: id, after: json(row!) });
  res.status(201).json({ data: json(row!) });
});

async function save(req: Request, res: import("express").Response) {
  manage(req);
  const current = await find(req);
  if (current.builtin_key) throw ValidationError.withMessages({ name: trans(req.locale, "eam.contract_category.builtin") });
  const data = await input(req, current);
  const changes: Record<string, unknown> = { updated_at: nowDb() };
  if ("name" in data) changes.name = String(data.name).trim();
  if ("is_active" in data) changes.is_active = bool(data.is_active);
  if ("sort_order" in data) changes.sort_order = data.sort_order;
  await update("contract_categories", changes, "id = ?", [current.id]);
  const row = await find(req);
  await audit(req, { action: "contract_category.updated", subjectType: "contract_category", subjectId: current.id, before: json(current), after: json(row) });
  res.json({ data: json(row) });
}
contractCategoryRoutes.put("/contract-categories/:id", save);
contractCategoryRoutes.patch("/contract-categories/:id", save);

contractCategoryRoutes.delete("/contract-categories/:id", async (req, res) => {
  manage(req);
  const current = await find(req);
  if (current.builtin_key) throw ValidationError.withMessages({ name: trans(req.locale, "eam.contract_category.builtin") });
  const used = Number(current.contracts_count ?? 0);
  if (used > 0) throw ValidationError.withMessages({ name: trans(req.locale, "eam.contract_category.in_use", { count: used }) });
  await exec("DELETE FROM contract_categories WHERE id = ?", [current.id]);
  await audit(req, { action: "contract_category.deleted", subjectType: "contract_category", subjectId: current.id, before: json(current) });
  res.status(204).end();
});
