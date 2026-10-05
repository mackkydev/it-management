import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, insert, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, forbidden, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { nowDb } from "../lib/time.js";
import { deleteUserTokens } from "../lib/tokens.js";
import { bool, exists, int, makeHash, notIn, password, unique, validate, regex } from "../lib/validator.js";
import { me, pageParam, paginated, simplePaginated } from "../http.js";
import { can, findUser, hasHistory, isLocalAdmin, ROLES, type UserRow } from "../models/user.js";
import { deactivateSignature } from "../services/signatures.js";
import { API_ROLES } from "../services/api-auth.js";
import { audit } from "../services/audit.js";
import { userResource } from "../resources.js";

/** UserController — ตัวเลือกผู้ถือครอง (admin/manager) และจัดการผู้ใช้ (admin) */
export const userRoutes = Router();

const ORG_FIELDS = ["branch_id", "department", "division", "supervisor_id", "is_it_staff", "is_it_head", "approval_route_id"] as const;

/** branch + supervisor + จำนวนสินทรัพย์ที่ถือครอง (ไม่นับที่ถูกลบ) */
const MANAGED_SELECT = `u.*, b.id AS b_id, b.name AS b_name, s.id AS s_id, s.name AS s_name,
  (SELECT COUNT(*) FROM assets a WHERE a.custodian_id = u.id AND a.deleted_at IS NULL) AS custodian_assets_count,
  (SELECT us.id FROM user_signatures us WHERE us.user_id = u.id AND us.is_active = true LIMIT 1) AS active_signature_id`;
const MANAGED_JOINS = `LEFT JOIN branches b ON b.id = u.branch_id AND b.deleted_at IS NULL
  LEFT JOIN users s ON s.id = u.supervisor_id`;

type ManagedRow = UserRow & { b_id: number | null; b_name: string; s_id: number | null; s_name: string; custodian_assets_count: number; active_signature_id: number | null };

const managed = (r: ManagedRow, viewerId?: number) =>
  userResource(r, {
    branch: r.b_id ? { id: r.b_id, name: r.b_name } : null,
    supervisor: r.s_id ? { id: r.s_id, name: r.s_name } : null,
    custodian_assets_count: Number(r.custodian_assets_count),
    signature_id: r.active_signature_id === null ? null : Number(r.active_signature_id),
  }, viewerId);

async function loadManaged(id: number): Promise<ManagedRow> {
  const row = await first<ManagedRow>(`SELECT ${MANAGED_SELECT} FROM users u ${MANAGED_JOINS} WHERE u.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
}

function searchWhere(term: unknown): { sql: string; params: unknown[] } {
  const t = String(term ?? "").trim();
  if (!t) return { sql: "1 = 1", params: [] };
  const esc = likeEscape(t);
  return { sql: "(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)", params: [`%${esc}%`, `${esc}%`, `${esc}%`] };
}

const routeUser = async (req: Request): Promise<UserRow> => {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const user = Number.isNaN(id) ? null : await findUser(id);
  if (!user) throw notFound();
  return user;
};

/**
 * GET /users?search=&per_page=20 — ผู้ใช้ที่ active สำหรับเลือกผู้ถือครอง (simplePaginate)
 * GET /users?manage=1&search=&role=&status=active|inactive&page= — หน้าจัดการผู้ใช้ (admin)
 */
userRoutes.get("/users", async (req, res) => {
  const u = me(req);
  const page = pageParam(req);

  if (bool(req.query.manage)) {
    authorize(can(u, "users.manage"));
    const f = await validate(
      req.input,
      {
        search: ["nullable", "string", "max:100"],
        role: ["nullable", `in:${ROLES.join(",")}`],
        status: ["nullable", "in:active,inactive"],
        per_page: ["nullable", "integer", "min:1", "max:100"],
      },
      { locale: req.locale },
    );
    const perPage = int(f.per_page) ?? 25;
    const s = searchWhere(f.search);
    const where = [s.sql];
    const params = [...s.params];
    if (f.role) (where.push("u.role = ?"), params.push(f.role));
    if (f.status) (where.push("u.is_active = ?"), params.push(f.status === "active"));
    const whereSql = where.join(" AND ");

    const total = Number(await scalar(`SELECT COUNT(*) FROM users u WHERE ${whereSql}`, params));
    const rows = await select<ManagedRow>(
      `SELECT ${MANAGED_SELECT} FROM users u ${MANAGED_JOINS} WHERE ${whereSql} ORDER BY u.name, u.id LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage],
    );
    return res.json(paginated(req, rows.map((r) => managed(r, u.id)), total, page, perPage));
  }

  // ผู้จัดการสินทรัพย์ (ผู้ถือครอง) และฝ่าย IT (ผู้ใช้ของการติดตั้ง license)
  authorize(can(u, "users.search"));
  const f = await validate(
    req.input,
    { search: ["nullable", "string", "max:100"], per_page: ["nullable", "integer", "min:1", "max:50"] },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 20;
  const s = searchWhere(f.search);
  // ดึงเกิน 1 แถวเพื่อรู้ว่ามีหน้าถัดไป (simplePaginate ไม่นับ total)
  const rows = await select<{ id: number; name: string; email: string }>(
    `SELECT u.id, u.name, u.email FROM users u WHERE ${s.sql} AND u.is_active = true ORDER BY u.name, u.id LIMIT ? OFFSET ?`,
    [...s.params, perPage + 1, (page - 1) * perPage],
  );
  res.json(simplePaginated(req, rows.map((r) => ({ id: r.id, name: r.name, email: r.email })), page, perPage, (f.per_page as string | null) ?? 20));
});

userRoutes.get("/users/:id", async (req, res) => {
  const target = await routeUser(req);
  const u = me(req);
  authorize(can(u, "users.manage") || u.id === target.id);
  res.json({ data: managed(await loadManaged(target.id), u.id), meta: { can_delete: !(await hasHistory(target.id)) } });
});

/** UserRequest: ตรวจสิทธิ์ก่อน validate (ผู้ที่ไม่ใช่ admin ได้ 403 ทันที) */
async function validatedUser(req: Request, target: UserRow | null) {
  if (!can(me(req), "users.manage")) throw forbidden();
  const s = target ? ["sometimes"] : [];
  const input = req.input;
  // API User: อีเมลว่างได้ (ต้นทางไม่ส่งมา), ไม่มีรหัสผ่าน, บทบาทได้เฉพาะ manager / viewer
  const isApi = target?.type === "API";
  return validate(
    input,
    {
      name: [...s, "required", "string", "max:255"],
      email: [...s, isApi ? "nullable" : "required", "string", "email", "max:255", unique("users", "email", target?.id)],
      // ชื่อผู้ใช้สำหรับ login: a-z 0-9 . _ - (ไม่มี @), ห้ามซ้ำแบบไม่สนตัวพิมพ์
      username: ["sometimes", "nullable", "string", "min:3", "max:50", regex(/^[A-Za-z0-9._-]+$/), unique("users", "username", target?.id)],
      role: [...s, "required", `in:${(isApi ? API_ROLES : ROLES).join(",")}`],
      is_active: ["sometimes", "boolean"],
      password: [target ? "nullable" : "required", "string", password(8, { letters: true, numbers: true })],
      branch_id: ["sometimes", "nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      department: ["sometimes", "nullable", "string", "max:100"],
      division: ["sometimes", "nullable", "string", "max:100"],
      supervisor_id: ["sometimes", "nullable", "integer", exists("users", "id", "is_active = true"), notIn(target ? [target.id] : [])],
      is_it_staff: ["sometimes", "boolean"],
      is_it_head: ["sometimes", "boolean"],
      approval_route_id: ["sometimes", "nullable", "integer", exists("approval_routes", "id")],
    },
    {
      locale: req.locale,
      // กัน admin ล็อกตัวเองออกจากระบบ: ห้ามลดบทบาทหรือปิดใช้งานบัญชีตัวเอง
      after: ({ errors }) => {
        if (isApi && typeof input.password === "string" && input.password !== "") errors.add("password", trans(req.locale, "eam.access.api_no_password"));
        if (!target || target.id !== me(req).id) return;
        if ("role" in input && input.role !== "admin") errors.add("role", trans(req.locale, "eam.user.self_lock"));
        if ("is_active" in input && !bool(input.is_active)) errors.add("is_active", trans(req.locale, "eam.user.self_lock"));
      },
    },
  );
}

function orgColumns(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ORG_FIELDS) {
    if (!(key in data)) continue;
    const v = data[key];
    out[key] = key === "branch_id" || key === "supervisor_id" || key === "approval_route_id" ? int(v) : key.startsWith("is_") ? bool(v) : v;
  }
  return out;
}

userRoutes.post("/users", async (req, res) => {
  const data = await validatedUser(req, null);
  const now = nowDb();
  const id = await insert("users", {
    name: data.name,
    email: String(data.email).toLowerCase(),
    username: data.username ? String(data.username).trim() : null,
    role: data.role,
    is_active: "is_active" in req.input ? bool(req.input.is_active) : true,
    password: makeHash(String(data.password), config.bcryptRounds),
    ...orgColumns(data),
    ...(data.role === "it_staff" ? { is_it_staff: true } : {}),
    created_at: now,
    updated_at: now,
  });
  res.status(201).json({ data: managed(await loadManaged(id), me(req).id) });
});

/** ปิดใช้งาน หรือรีเซ็ตรหัสผ่าน → เพิกถอน token ทุกอุปกรณ์ของผู้ใช้นั้นทันที */
async function updateUser(req: Request, res: import("express").Response) {
  const target = await routeUser(req);
  const data = await validatedUser(req, target);

  await transaction(async () => {
    const changes: Record<string, unknown> = { ...orgColumns(data) };
    if ("name" in data) changes.name = data.name;
    if ("username" in data) changes.username = data.username ? String(data.username).trim() : null;
    if ("email" in data) changes.email = data.email === null ? null : String(data.email).toLowerCase();
    if ("role" in data) changes.role = data.role;
    if (data.role === "it_staff") changes.is_it_staff = true;
    if ("is_active" in data) changes.is_active = bool(data.is_active);
    const newPassword = target.type === "LOCAL" && typeof req.input.password === "string" && req.input.password !== "";
    if (newPassword) changes.password = makeHash(req.input.password, config.bcryptRounds);

    if (Object.keys(changes).length) await update("users", { ...changes, updated_at: nowDb() }, "id = ?", [target.id]);

    const deactivated = "is_active" in changes && changes.is_active === false && target.is_active;
    if (newPassword || deactivated) await deleteUserTokens(target.id);
  });

  // บันทึกการเปลี่ยนสิทธิ์ (บทบาท / สถานะ / สิทธิ์ฝ่าย IT)
  const fresh = (await findUser(target.id))!;
  const pick = (u: UserRow) => ({ role: u.role, is_active: Boolean(u.is_active), is_it_staff: Boolean(u.is_it_staff), is_it_head: Boolean(u.is_it_head) });
  if (JSON.stringify(pick(target)) !== JSON.stringify(pick(fresh))) {
    await audit(req, { action: "user.access_updated", subjectType: "user", subjectId: target.id, before: pick(target), after: pick(fresh) });
  }

  res.json({ data: managed(await loadManaged(target.id), me(req).id) });
}

userRoutes.put("/users/:id", updateUser);
userRoutes.patch("/users/:id", updateUser);

/** ลบได้เฉพาะผู้ใช้ที่ไม่มีประวัติในระบบ — ถ้ามี ให้ปิดใช้งานแทน */
userRoutes.delete("/users/:id", async (req, res) => {
  const target = await routeUser(req);
  const u = me(req);
  authorize(can(u, "users.manage"));
  if (u.id === target.id) throw ValidationError.withMessages({ user: trans(req.locale, "eam.user.self_delete") });
  if (await hasHistory(target.id)) throw ValidationError.withMessages({ user: trans(req.locale, "eam.user.has_history") });

  await transaction(async () => {
    await deleteUserTokens(target.id);
    await exec("DELETE FROM users WHERE id = ?", [target.id]);
  });
  res.status(204).end();
});

/** DELETE /users/{id}/signature — Local Admin ลบ (ปิดใช้งาน) ลายเซ็นของผู้ใช้เมื่อจำเป็น — แถวยังอยู่เป็นประวัติ + audit */
userRoutes.delete("/users/:id/signature", async (req, res) => {
  authorize(isLocalAdmin(me(req)));
  const target = await routeUser(req);
  if (!(await deactivateSignature(target.id, req, true))) throw notFound();
  res.status(204).end();
});
