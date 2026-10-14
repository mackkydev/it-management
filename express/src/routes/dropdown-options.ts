import { Router, type Request } from "express";
import { exec, first, insert, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { bool, custom, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audit } from "../services/audit.js";
import { isBuiltinName } from "../services/categories.js";

/**
 * ข้อมูลหลัก → ข้อมูล Drop Down (ตาราง dropdown_options) — ค่าที่เลือกยังเก็บเป็นข้อความในตารางเดิม
 * (ห้องประชุม: ประเภทการใช้งาน = meeting_bookings.purpose, อุปกรณ์ = meeting_booking_equipment.name — จัดการด้วยสิทธิ์ meeting.rooms)
 * (จองรถ: ประเภทการใช้งาน = vehicle_bookings.purpose, รายการเพิ่มเติม = vehicle_booking_extras.name, ประเภทรถ / เชื้อเพลิง = vehicles.vehicle_type / fuel_type — จัดการด้วยสิทธิ์ vehicle.manage)
 *   GET    /dropdown-options/{list}                  ที่เปิดใช้งาน (ฟอร์ม) · ?include_inactive=1 (dropdowns.manage) = ทั้งหมด + จำนวนที่ใช้
 *   POST   /dropdown-options/{list} { name, ... }    จัดการ (dropdowns.manage) หรือ "เพิ่มด่วน" จากฟอร์ม (สิทธิ์เพิ่ม/แก้ข้อมูลของระบบนั้น)
 *   PUT|PATCH /dropdown-options/{list}/{id}          เปลี่ยนชื่อ → ข้อมูลเดิมที่ใช้ชื่อนี้เปลี่ยนตาม
 *   DELETE /dropdown-options/{list}/{id}             ลบได้เมื่อไม่มีข้อมูลใช้อยู่ — มิฉะนั้นให้ปิดใช้งาน
 */
export const dropdownOptionRoutes = Router();

interface ListConfig {
  max: number;
  /** สิทธิ์ที่ "เพิ่มด่วน" จากฟอร์มได้ */
  quickAdd: string[];
  /** สิทธิ์จัดการรายการนี้ (ไม่ระบุ = dropdowns.manage) */
  manage?: string;
  /** subquery นับข้อมูลที่ใช้ค่านี้ (alias o = dropdown_options) */
  usage: string;
  /** เปลี่ยนชื่อ → ข้อมูลเดิมที่ใช้ชื่อนี้เปลี่ยนตาม */
  rename: (to: string, from: string) => Promise<unknown>;
}

/** ค่าเก็บเป็นข้อความในคอลัมน์ของตาราง (ตารางมี deleted_at + updated_at) */
const textColumn = (table: string, column: string): Pick<ListConfig, "usage" | "rename"> => ({
  usage: `(SELECT COUNT(*) FROM ${table} x WHERE LOWER(TRIM(x.${column})) = LOWER(o.name) AND x.deleted_at IS NULL)`,
  rename: (to, from) => exec(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE LOWER(TRIM(${column})) = LOWER(?)`, [to, nowDb(), from]),
});

const LISTS: Record<string, ListConfig> = {
  computer_type: { ...textColumn("assets", "computer_type"), max: 30, quickAdd: ["assets.create", "assets.update"] },
  brand: { ...textColumn("assets", "brand"), max: 100, quickAdd: ["assets.create", "assets.update"] },
  vault_category: { ...textColumn("credentials", "category"), max: 30, quickAdd: ["vault.create", "vault.update"] },
  meeting_purpose: { ...textColumn("meeting_bookings", "purpose"), max: 100, quickAdd: [], manage: "meeting.rooms" },
  vehicle_purpose: { ...textColumn("vehicle_bookings", "purpose"), max: 100, quickAdd: [], manage: "vehicle.manage" },
  // ประเภทรถ / เชื้อเพลิง = vehicles.vehicle_type / fuel_type (ตาราง vehicles ไม่มี deleted_at)
  vehicle_type: {
    max: 50,
    quickAdd: [],
    manage: "vehicle.manage",
    usage: "(SELECT COUNT(*) FROM vehicles x WHERE LOWER(TRIM(x.vehicle_type)) = LOWER(o.name))",
    rename: (to, from) => exec("UPDATE vehicles SET vehicle_type = ?, updated_at = ? WHERE LOWER(TRIM(vehicle_type)) = LOWER(?)", [to, nowDb(), from]),
  },
  vehicle_fuel: {
    max: 50,
    quickAdd: [],
    manage: "vehicle.manage",
    usage: "(SELECT COUNT(*) FROM vehicles x WHERE LOWER(TRIM(x.fuel_type)) = LOWER(o.name))",
    rename: (to, from) => exec("UPDATE vehicles SET fuel_type = ?, updated_at = ? WHERE LOWER(TRIM(fuel_type)) = LOWER(?)", [to, nowDb(), from]),
  },
  vehicle_extra: {
    max: 100,
    quickAdd: [],
    manage: "vehicle.manage",
    usage: "(SELECT COUNT(*) FROM vehicle_booking_extras x JOIN vehicle_bookings b ON b.id = x.booking_id WHERE LOWER(TRIM(x.name)) = LOWER(o.name) AND b.deleted_at IS NULL)",
    rename: async (to, from) => {
      await exec("UPDATE IGNORE vehicle_booking_extras SET name = ? WHERE LOWER(TRIM(name)) = LOWER(?)", [to, from]);
      await exec("DELETE FROM vehicle_booking_extras WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(?) <> LOWER(?)", [from, from, to]);
    },
  },
  meeting_equipment: {
    max: 100,
    quickAdd: [],
    manage: "meeting.rooms",
    usage: "(SELECT COUNT(*) FROM meeting_booking_equipment x JOIN meeting_bookings b ON b.id = x.booking_id WHERE LOWER(TRIM(x.name)) = LOWER(o.name) AND b.deleted_at IS NULL)",
    // การจองที่มีทั้งชื่อเดิมและชื่อใหม่อยู่แล้ว (ซ้ำ primary key) — ข้ามแล้วลบแถวชื่อเดิมที่เหลือ
    rename: async (to, from) => {
      await exec("UPDATE IGNORE meeting_booking_equipment SET name = ? WHERE LOWER(TRIM(name)) = LOWER(?)", [to, from]);
      await exec("DELETE FROM meeting_booking_equipment WHERE LOWER(TRIM(name)) = LOWER(?) AND LOWER(?) <> LOWER(?)", [from, from, to]);
    },
  },
};

interface OptionRow {
  id: number;
  list: string;
  name: string;
  is_active: boolean | number;
  sort_order: number;
  usage_count?: number | string;
}

const json = (r: OptionRow) => ({
  id: Number(r.id),
  name: r.name,
  is_active: Boolean(r.is_active),
  sort_order: Number(r.sort_order),
  ...(r.usage_count !== undefined ? { usage_count: Number(r.usage_count) } : {}),
});

function listOf(req: Request): [string, ListConfig] {
  const key = String(req.params.list);
  const cfg = LISTS[key];
  if (!cfg) throw notFound();
  return [key, cfg];
}

const usage = (cfg: ListConfig) => cfg.usage;
const manages = (u: UserRow, cfg: ListConfig) => can(u, cfg.manage ?? "dropdowns.manage");

async function find(req: Request, list: string, cfg: ListConfig): Promise<OptionRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<OptionRow>(`SELECT o.*, ${usage(cfg)} AS usage_count FROM dropdown_options o WHERE o.id = ? AND o.list = ?`, [id, list]);
  if (!row) throw notFound();
  return row;
}

const input = (req: Request, list: string, cfg: ListConfig, current: OptionRow | null) =>
  validate(
    req.input,
    {
      name: [
        current ? "sometimes" : "required",
        "string",
        `max:${cfg.max}`,
        custom(async (v) => {
          const name = String(v).trim();
          if (list === "vault_category" && isBuiltinName(name)) return false;
          const dup = await scalar(
            `SELECT 1 FROM dropdown_options WHERE list = ? AND LOWER(name) = LOWER(?)${current ? " AND id <> ?" : ""}`,
            current ? [list, name, current.id] : [list, name],
          );
          return dup === null;
        }, trans(req.locale, "eam.org.duplicate")),
      ],
      is_active: ["sometimes", "boolean"],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
    },
    { locale: req.locale },
  );

dropdownOptionRoutes.get("/dropdown-options/:list", async (req, res) => {
  const [list, cfg] = listOf(req);
  if (bool(req.query.include_inactive)) {
    authorize(manages(me(req), cfg));
    const rows = await select<OptionRow>(`SELECT o.*, ${usage(cfg)} AS usage_count FROM dropdown_options o WHERE o.list = ? ORDER BY o.sort_order, o.name`, [list]);
    return res.json({ data: rows.map(json) });
  }
  const rows = await select<OptionRow>("SELECT * FROM dropdown_options o WHERE o.list = ? AND o.is_active = true ORDER BY o.sort_order, o.name", [list]);
  res.json({ data: rows.map(json) });
});

dropdownOptionRoutes.post("/dropdown-options/:list", async (req, res) => {
  const [list, cfg] = listOf(req);
  const u = me(req);
  // ผู้จัดการข้อมูล หรือผู้ที่เพิ่ม/แก้ข้อมูลของระบบนั้นได้ ("เพิ่มด่วน" จากฟอร์ม)
  authorize(manages(u, cfg) || cfg.quickAdd.some((k) => can(u, k)));
  const data = await input(req, list, cfg, null);
  const now = nowDb();
  const id = await insert("dropdown_options", {
    list,
    name: String(data.name).trim(),
    is_active: "is_active" in data && manages(u, cfg) ? bool(data.is_active) : true,
    sort_order: manages(u, cfg) ? (data.sort_order ?? 0) : 0,
    created_at: now,
    updated_at: now,
  });
  const row = (await first<OptionRow>(`SELECT o.*, ${usage(cfg)} AS usage_count FROM dropdown_options o WHERE o.id = ?`, [id]))!;
  await audit(req, { action: "dropdown_option.created", subjectType: "dropdown_option", subjectId: id, after: { list, ...json(row) } });
  res.status(201).json({ data: json(row) });
});

async function save(req: Request, res: import("express").Response) {
  const [list, cfg] = listOf(req);
  authorize(manages(me(req), cfg));
  const current = await find(req, list, cfg);
  const data = await input(req, list, cfg, current);
  const changes: Record<string, unknown> = { updated_at: nowDb() };
  if ("name" in data) changes.name = String(data.name).trim();
  if ("is_active" in data) changes.is_active = bool(data.is_active);
  if ("sort_order" in data) changes.sort_order = data.sort_order;
  await transaction(async () => {
    await update("dropdown_options", changes, "id = ?", [current.id]);
    // เปลี่ยนชื่อ → ข้อมูลเดิมที่ใช้ชื่อนี้เปลี่ยนตาม
    if (typeof changes.name === "string" && changes.name !== current.name) await cfg.rename(changes.name, current.name);
  });
  const row = await find(req, list, cfg);
  await audit(req, { action: "dropdown_option.updated", subjectType: "dropdown_option", subjectId: current.id, before: { list, ...json(current) }, after: { list, ...json(row) } });
  res.json({ data: json(row) });
}
dropdownOptionRoutes.put("/dropdown-options/:list/:id", save);
dropdownOptionRoutes.patch("/dropdown-options/:list/:id", save);

dropdownOptionRoutes.delete("/dropdown-options/:list/:id", async (req, res) => {
  const [list, cfg] = listOf(req);
  authorize(manages(me(req), cfg));
  const current = await find(req, list, cfg);
  const used = Number(current.usage_count ?? 0);
  if (used > 0) throw ValidationError.withMessages({ name: trans(req.locale, "eam.dropdown.in_use", { count: used }) });
  await exec("DELETE FROM dropdown_options WHERE id = ?", [current.id]);
  await audit(req, { action: "dropdown_option.deleted", subjectType: "dropdown_option", subjectId: current.id, before: { list, ...json(current) } });
  res.status(204).end();
});
