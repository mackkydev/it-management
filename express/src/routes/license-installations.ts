import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { dateOnly, iso, localToday, nowDb } from "../lib/time.js";
import { exists, int, validate } from "../lib/validator.js";
import { me, pageParam, shortMeta } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { activeCount, daysLeft, LICENSE_CATEGORY } from "../services/asset-licenses.js";

/**
 * การติดตั้ง software license — เหมือน LicenseInstallationController ของ Laravel
 *   GET    /license-installations?license_id=&status=active|removed|all&branch_id=&search=&per_page=
 *   GET    /license-installations/licenses          license ทั้งหมด + จำนวนที่ใช้/คงเหลือ
 *   POST   /license-installations                   { license_id, device_asset_id | device_name, user_id, branch_id, installed_at, notes }
 *   POST   /license-installations/{id}/uninstall    { uninstalled_at } — คืน seat (เก็บเป็นประวัติ)
 *   DELETE /license-installations/{id}              ลบรายการที่บันทึกผิด
 * ผู้ใช้: ผู้จัดการสินทรัพย์ หรือฝ่าย IT — license ที่กำหนดจำนวน seat บันทึกเกินจำนวนไม่ได้
 */
export const licenseInstallationRoutes = Router();

const allowed = (u: UserRow) => can(u, "licenses.install");

interface Row {
  id: number;
  installed_at: string;
  uninstalled_at: string | null;
  notes: string | null;
  device_name: string | null;
  created_at: string | null;
  la_uuid: string; la_tag: string; la_name: string;
  da_uuid: string | null; da_tag: string | null; da_name: string | null;
  u_id: number | null; u_name: string | null;
  b_id: number | null; b_name: string | null;
  cb_id: number | null; cb_name: string | null;
}

const SELECT = `i.id, i.installed_at, i.uninstalled_at, i.notes, i.device_name, i.created_at,
    la.uuid AS la_uuid, la.asset_tag AS la_tag, la.name AS la_name,
    da.uuid AS da_uuid, da.asset_tag AS da_tag, da.name AS da_name,
    u.id AS u_id, u.name AS u_name, b.id AS b_id, b.name AS b_name, cb.id AS cb_id, cb.name AS cb_name
  FROM license_installations i
  JOIN assets la ON la.id = i.license_asset_id
  LEFT JOIN assets da ON da.id = i.device_asset_id
  LEFT JOIN users u ON u.id = i.user_id
  LEFT JOIN branches b ON b.id = i.branch_id
  LEFT JOIN users cb ON cb.id = i.created_by`;

const json = (r: Row) => ({
  id: r.id,
  license: { id: r.la_uuid, asset_tag: r.la_tag, name: r.la_name },
  device: r.da_uuid ? { id: r.da_uuid, asset_tag: r.da_tag, name: r.da_name } : null,
  device_name: r.device_name,
  user: r.u_id ? { id: r.u_id, name: r.u_name } : null,
  branch: r.b_id ? { id: r.b_id, name: r.b_name } : null,
  installed_at: dateOnly(r.installed_at),
  uninstalled_at: dateOnly(r.uninstalled_at),
  notes: r.notes,
  created_by: r.cb_id ? { id: r.cb_id, name: r.cb_name } : null,
  created_at: iso(r.created_at),
});

const usage = (seats: number | null, used: number) => ({ seats, used, available: seats === null ? null : Math.max(0, seats - used) });

/** สินทรัพย์ SOFTWARE ที่มีข้อมูล license (ไม่นับที่ถูกลบ) */
const findLicense = (uuid: unknown) =>
  typeof uuid === "string" && isUuid(uuid)
    ? first<{ id: number; uuid: string; seats: number | null }>(
        `SELECT a.id, a.uuid, li.seats FROM assets a JOIN asset_licenses li ON li.asset_id = a.id
          WHERE a.uuid = ? AND a.category = ? AND a.deleted_at IS NULL`,
        [uuid, LICENSE_CATEGORY],
      )
    : Promise.resolve(null);

licenseInstallationRoutes.get("/license-installations/licenses", async (req, res) => {
  authorize(allowed(me(req)));
  const rows = await select<{ id: number; uuid: string; asset_tag: string; name: string; seats: number | null; expires_at: string | null; used: number }>(
    `SELECT a.id, a.uuid, a.asset_tag, a.name, li.seats, li.expires_at,
            (SELECT COUNT(*) FROM license_installations i WHERE i.license_asset_id = a.id AND i.uninstalled_at IS NULL) AS used
       FROM assets a JOIN asset_licenses li ON li.asset_id = a.id
      WHERE a.category = ? AND a.deleted_at IS NULL
      ORDER BY a.name, a.id`,
    [LICENSE_CATEGORY],
  );
  res.json({
    data: rows.map((r) => ({
      id: r.uuid,
      asset_tag: r.asset_tag,
      name: r.name,
      ...usage(r.seats, Number(r.used)),
      expires_at: dateOnly(r.expires_at),
      days_left: daysLeft(dateOnly(r.expires_at)),
    })),
  });
});

licenseInstallationRoutes.get("/license-installations", async (req, res) => {
  authorize(allowed(me(req)));
  const f = await validate(
    req.input,
    {
      license_id: ["nullable", "string", "max:36"],
      status: ["nullable", "in:active,removed,all"],
      branch_id: ["nullable", "integer"],
      search: ["nullable", "string", "max:100"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const where: string[] = ["la.deleted_at IS NULL"];
  const params: unknown[] = [];
  let license: Awaited<ReturnType<typeof findLicense>> = null;
  if (f.license_id) {
    license = await findLicense(f.license_id);
    if (!license) throw notFound();
    where.push("i.license_asset_id = ?");
    params.push(license.id);
  }
  const status = (f.status as string | null) ?? "active";
  if (status === "active") where.push("i.uninstalled_at IS NULL");
  if (status === "removed") where.push("i.uninstalled_at IS NOT NULL");
  if (f.branch_id) (where.push("i.branch_id = ?"), params.push(int(f.branch_id)));
  const term = String(f.search ?? "").trim();
  if (term) {
    const esc = `%${likeEscape(term)}%`;
    where.push("(i.device_name ILIKE ? OR da.asset_tag ILIKE ? OR da.name ILIKE ? OR u.name ILIKE ?)");
    params.push(esc, esc, esc, esc);
  }
  const whereSql = where.join(" AND ");
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  const FROM = SELECT.slice(SELECT.indexOf("FROM"));

  const total = Number(await scalar(`SELECT COUNT(*) ${FROM} WHERE ${whereSql}`, params));
  const rows = await select<Row>(`SELECT ${SELECT} WHERE ${whereSql} ORDER BY i.installed_at DESC, i.id DESC LIMIT ? OFFSET ?`, [
    ...params, perPage, (page - 1) * perPage,
  ]);
  res.json({
    data: rows.map(json),
    meta: shortMeta(total, page, perPage, rows.length),
    ...(license ? { usage: usage(license.seats, await activeCount(license.id)) } : {}),
  });
});

licenseInstallationRoutes.post("/license-installations", async (req, res) => {
  const u = me(req);
  authorize(allowed(u));
  const input = req.input;
  const data = await validate(
    input,
    {
      license_id: ["required", "string", "max:36"],
      device_asset_id: ["nullable", "string", "max:36"],
      device_name: ["nullable", "string", "max:255"],
      user_id: ["nullable", "integer", exists("users", "id")],
      branch_id: ["nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      installed_at: ["required", "date", `before_or_equal:${localToday()}`],
      notes: ["nullable", "string", "max:2000"],
    },
    {
      locale: req.locale,
      after: async ({ errors }) => {
        if (!errors.has("license_id") && !(await findLicense(input.license_id))) errors.add("license_id", trans(req.locale, "eam.license.not_license"));
        const hasDevice = typeof input.device_asset_id === "string" && input.device_asset_id !== "";
        if (hasDevice && !(await deviceId(input.device_asset_id))) errors.add("device_asset_id", trans(req.locale, "eam.license.device_invalid"));
        if (!hasDevice && !(typeof input.device_name === "string" && input.device_name.trim() !== "") && !errors.has("device_name")) {
          errors.add("device_name", trans(req.locale, "eam.license.device_required"));
        }
      },
    },
  );

  const license = (await findLicense(data.license_id))!;
  const id = await transaction(async () => {
    // ล็อกแถว license กันบันทึกพร้อมกันจนเกินจำนวน seat
    const locked = await first<{ seats: number | null }>("SELECT seats FROM asset_licenses WHERE asset_id = ? FOR UPDATE", [license.id]);
    const seats = locked?.seats ?? null;
    if (seats !== null && (await activeCount(license.id)) >= seats) {
      throw ValidationError.withMessages({ license_id: trans(req.locale, "eam.license.seats_full", { seats }) });
    }
    const now = nowDb();
    const device = typeof data.device_asset_id === "string" && data.device_asset_id !== "" ? await deviceId(data.device_asset_id) : null;
    return insert("license_installations", {
      license_asset_id: license.id,
      device_asset_id: device,
      device_name: device ? null : String(data.device_name).trim(),
      user_id: int(data.user_id),
      branch_id: int(data.branch_id),
      installed_at: String(data.installed_at).slice(0, 10),
      notes: typeof data.notes === "string" && data.notes.trim() !== "" ? data.notes.trim() : null,
      created_by: u.id,
      created_at: now,
      updated_at: now,
    });
  });
  res.status(201).json({ data: json((await first<Row>(`SELECT ${SELECT} WHERE i.id = ?`, [id]))!) });
});

/** id ของสินทรัพย์ที่เลือกเป็นเครื่อง (ไม่นับที่ถูกลบ) */
async function deviceId(uuid: unknown): Promise<number | null> {
  if (typeof uuid !== "string" || !isUuid(uuid)) return null;
  return (await scalar<number>("SELECT id FROM assets WHERE uuid = ? AND deleted_at IS NULL", [uuid])) ?? null;
}

async function findInstallation(req: Request) {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<{ id: number; installed_at: string; uninstalled_at: string | null }>(
    "SELECT id, installed_at, uninstalled_at FROM license_installations WHERE id = ?",
    [id],
  );
  if (!row) throw notFound();
  return row;
}

licenseInstallationRoutes.post("/license-installations/:id/uninstall", async (req, res) => {
  const row = await findInstallation(req);
  authorize(allowed(me(req)));
  const installed = dateOnly(row.installed_at)!;
  const data = await validate(
    req.input,
    { uninstalled_at: ["nullable", "date", `after_or_equal:${installed}`, `before_or_equal:${localToday()}`] },
    {
      locale: req.locale,
      after: ({ errors }) => {
        if (row.uninstalled_at !== null) errors.add("uninstalled_at", trans(req.locale, "eam.license.already_removed"));
      },
    },
  );
  const date = typeof data.uninstalled_at === "string" && data.uninstalled_at !== "" ? data.uninstalled_at.slice(0, 10) : localToday();
  await update("license_installations", { uninstalled_at: date, updated_at: nowDb() }, "id = ?", [row.id]);
  res.json({ data: json((await first<Row>(`SELECT ${SELECT} WHERE i.id = ?`, [row.id]))!) });
});

licenseInstallationRoutes.delete("/license-installations/:id", async (req, res) => {
  const row = await findInstallation(req);
  authorize(allowed(me(req)));
  await exec("DELETE FROM license_installations WHERE id = ?", [row.id]);
  res.status(204).end();
});
