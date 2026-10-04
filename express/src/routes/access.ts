import { Router, type Request } from "express";
import { exec, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb } from "../lib/time.js";
import { deleteUserTokens } from "../lib/tokens.js";
import { bool, int, validate } from "../lib/validator.js";
import { me, pageParam, paginated } from "../http.js";
import { AUDIENCES, PERMISSION_KEYS, PERMISSIONS } from "../models/permission.js";
import { findUser, hasHistory, isLocalAdmin, ROLES, type UserRow } from "../models/user.js";
import { API_ROLES } from "../services/api-auth.js";
import { audit } from "../services/audit.js";
import { audiencePermissions, audiencesOf, permissionsOf } from "../services/permissions.js";

/**
 * จัดการสิทธิ์ / API User / audit log — Local Admin เท่านั้น
 *   GET  /permissions                   รายการสิทธิ์ + สิทธิ์ของแต่ละกลุ่ม
 *   GET  /users/{id}/permissions        สิทธิ์ของผู้ใช้: จากกลุ่ม + เพิ่ม/ถอดรายคน + สิทธิ์จริง
 *   PUT  /users/{id}/permissions        { role? (API User: manager|viewer), overrides: { key: allow|deny|inherit } }
 *   GET  /api-users                     รายการ API User (ค้นหา / role / สถานะ / การเชื่อมต่อ / อีเมลซ้ำ)
 *   POST /api-users/{id}/link           { local_user_id } ผูก API User กับบัญชี LOCAL เดิม (กรณีอีเมลซ้ำ)
 *   GET  /audit-logs                    บันทึกการเปลี่ยนแปลง (action / subject / ผู้ทำ / ช่วงเวลา)
 * ทุกการเปลี่ยนสิทธิ์/การผูกบัญชีบันทึก audit_logs (ก่อน-หลัง)
 */
export const accessRoutes = Router();

const guard = (req: Request) => {
  const u = me(req);
  authorize(isLocalAdmin(u));
  return u;
};

async function target(req: Request): Promise<UserRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const user = Number.isNaN(id) ? null : await findUser(id);
  if (!user) throw notFound();
  return user;
}

const overridesOf = async (userId: number) =>
  Object.fromEntries(
    (
      await select<{ key: string; effect: string }>(
        "SELECT p.key, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ? ORDER BY p.key",
        [userId],
      )
    ).map((r) => [r.key, r.effect]),
  ) as Record<string, "allow" | "deny">;

async function permissionView(u: UserRow) {
  const groups = audiencesOf(u);
  const byGroup = await audiencePermissions();
  const inherited = [...new Set(groups.flatMap((g) => byGroup[g] ?? []))].sort();
  return {
    user: { id: u.id, name: u.name, email: u.email, type: u.type, role: u.role, is_active: Boolean(u.is_active), is_it_staff: Boolean(u.is_it_staff), is_it_head: Boolean(u.is_it_head) },
    groups,
    inherited,
    overrides: await overridesOf(u.id),
    effective: [...(await permissionsOf(u))].sort(),
    /** Local Admin ผ่านทุกสิทธิ์ — เพิ่ม/ถอดรายคนไม่มีผล */
    is_local_admin: isLocalAdmin(u),
  };
}

accessRoutes.get("/permissions", async (req, res) => {
  guard(req);
  res.json({
    data: PERMISSIONS.map(({ key, group, name_th, name_en }) => ({ key, group, name_th, name_en })),
    role_permissions: await audiencePermissions(),
  });
});

/** PUT /permissions/roles/{group} { keys: [...] } — กำหนดสิทธิ์ทั้งชุดของกลุ่ม (admin = Local Admin ผ่านทุกสิทธิ์อยู่แล้ว แต่ยังมีผลกับ API User ที่ role admin) */
accessRoutes.put("/permissions/roles/:group", async (req, res) => {
  guard(req);
  const group = String(req.params.group);
  if (!(AUDIENCES as readonly string[]).includes(group)) throw notFound();
  const keys = Array.isArray(req.input.keys) ? (req.input.keys as unknown[]).map(String) : null;
  if (!keys || keys.some((k) => !PERMISSION_KEYS.includes(k))) throw ValidationError.withMessages({ keys: trans(req.locale, "eam.access.invalid_override") });

  const before = (await audiencePermissions())[group as (typeof AUDIENCES)[number]];
  await transaction(async () => {
    await exec("DELETE FROM role_permissions WHERE role = ?", [group]);
    for (const key of new Set(keys)) {
      await exec("INSERT INTO role_permissions (role, permission_id, created_at) SELECT ?, id, ? FROM permissions WHERE key = ?", [group, nowDb(), key]);
    }
  });
  const after = (await audiencePermissions())[group as (typeof AUDIENCES)[number]];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await audit(req, { action: "role.permissions_updated", subjectType: "role", subjectId: group, before: { keys: before }, after: { keys: after } });
  }
  res.json({ data: after });
});

accessRoutes.get("/users/:id/permissions", async (req, res) => {
  guard(req);
  res.json({ data: await permissionView(await target(req)) });
});

accessRoutes.put("/users/:id/permissions", async (req, res) => {
  guard(req);
  const u = await target(req);
  const input = req.input;
  const data = await validate(
    input,
    { role: ["sometimes", `in:${ROLES.join(",")}`], overrides: ["sometimes", "nullable"] },
    {
      locale: req.locale,
      after: ({ errors }) => {
        // API User เป็นได้เฉพาะ manager / viewer; บทบาทของผู้ใช้ LOCAL แก้ที่หน้าผู้ใช้
        if ("role" in input && (u.type !== "API" || !API_ROLES.includes(input.role))) errors.add("role", trans(req.locale, "eam.api_connection.invalid_role"));
        const o = input.overrides;
        if (o === undefined || o === null) return;
        if (typeof o !== "object" || Array.isArray(o)) return errors.add("overrides", trans(req.locale, "eam.access.invalid_override"));
        for (const [key, effect] of Object.entries(o)) {
          if (!PERMISSION_KEYS.includes(key) || !["allow", "deny", "inherit"].includes(String(effect))) errors.add(`overrides.${key}`, trans(req.locale, "eam.access.invalid_override"));
        }
      },
    },
  );

  const before = { role: u.role, overrides: await overridesOf(u.id) };
  await transaction(async () => {
    if ("role" in data && data.role !== u.role) await update("users", { role: data.role, updated_at: nowDb() }, "id = ?", [u.id]);
    for (const [key, effect] of Object.entries((input.overrides ?? {}) as Record<string, string>)) {
      const pid = await scalar<number>("SELECT id FROM permissions WHERE key = ?", [key]);
      if (pid === null) continue;
      if (effect === "inherit") await exec("DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?", [u.id, pid]);
      else
        await exec(
          `INSERT INTO user_permissions (user_id, permission_id, effect, created_by, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, permission_id) DO UPDATE SET effect = EXCLUDED.effect, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at`,
          [u.id, pid, effect, me(req).id, nowDb()],
        );
    }
  });
  const fresh = (await findUser(u.id))!;
  const after = { role: fresh.role, overrides: await overridesOf(u.id) };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await audit(req, { action: "user.permissions_updated", subjectType: "user", subjectId: u.id, before, after });
  }
  res.json({ data: await permissionView(fresh) });
});

/* ---------------------------------------------------------------- API User */

interface ApiUserRow {
  id: number;
  name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  external_id: string;
  external_synced_at: string | null;
  created_at: string | null;
  connection_id: number;
  connection_name: string;
  overrides_count: number;
  conflict_email: string | null;
  conflict_user_id: number | null;
}

accessRoutes.get("/api-users", async (req, res) => {
  guard(req);
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      role: ["nullable", `in:${API_ROLES.join(",")}`],
      status: ["nullable", "in:active,inactive"],
      connection_id: ["nullable", "integer"],
      conflict: ["nullable", "boolean"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  const where = ["u.type = 'API'"];
  const params: unknown[] = [];
  const term = String(f.search ?? "").trim();
  if (term) {
    const esc = likeEscape(term);
    where.push("(u.name ILIKE ? OR u.email ILIKE ? OR u.external_id ILIKE ?)");
    params.push(`%${esc}%`, `%${esc}%`, `${esc}%`);
  }
  if (f.role) (where.push("u.role = ?"), params.push(f.role));
  if (f.status) (where.push("u.is_active = ?"), params.push(f.status === "active"));
  if (f.connection_id) (where.push("u.connection_id = ?"), params.push(int(f.connection_id)));
  // อีเมลจากต้นทางซ้ำกับผู้ใช้อื่นที่ยังมีอยู่ และยังไม่ได้ใช้อีเมลนั้น — รอ admin ผูกบัญชี
  const conflict = `(SELECT a.after->>'email' FROM audit_logs a WHERE a.action = 'api_user.email_conflict' AND a.subject_type = 'user' AND a.subject_id = u.id::text
      AND EXISTS (SELECT 1 FROM users o WHERE LOWER(o.email) = LOWER(a.after->>'email') AND o.id <> u.id) ORDER BY a.id DESC LIMIT 1)`;
  if (bool(f.conflict)) where.push(`${conflict} IS NOT NULL`);
  const whereSql = where.join(" AND ");

  const total = Number(await scalar(`SELECT COUNT(*) FROM users u WHERE ${whereSql}`, params));
  const rows = await select<ApiUserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.external_id, u.external_synced_at, u.created_at, u.connection_id,
       c.name AS connection_name,
       (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = u.id) AS overrides_count,
       ${conflict} AS conflict_email,
       (SELECT o.id FROM users o WHERE LOWER(o.email) = LOWER(${conflict}) AND o.id <> u.id LIMIT 1) AS conflict_user_id
     FROM users u JOIN api_connections c ON c.id = u.connection_id
     WHERE ${whereSql} ORDER BY u.name, u.id LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  res.json(
    paginated(
      req,
      rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        overrides_count: Number(r.overrides_count),
        external_synced_at: iso(r.external_synced_at),
        created_at: iso(r.created_at),
      })),
      total,
      page,
      perPage,
    ),
  );
});

/**
 * ผูกบัญชี: บัญชี LOCAL เดิม (มีประวัติอยู่) กลายเป็น API User ของตัวตนต้นทางนี้ — login ด้วยรหัสผ่านเดิมไม่ได้อีก
 * แถว API User ที่ระบบสร้างให้ตอน login ครั้งแรกถูกลบ (ต้องยังไม่มีประวัติ)
 * ห้ามผูกกับ admin เพื่อกันการยึดบัญชีผู้ดูแลระบบผ่านต้นทาง
 */
accessRoutes.post("/api-users/:id/link", async (req, res) => {
  guard(req);
  const api = await target(req);
  const data = await validate(req.input, { local_user_id: ["required", "integer"] }, { locale: req.locale });
  const local = await findUser(Number(data.local_user_id));
  const t = (key: string) => trans(req.locale, `eam.access.${key}`);
  if (api.type !== "API") throw ValidationError.withMessages({ id: t("not_api_user") });
  if (!local || local.type !== "LOCAL" || local.id === api.id) throw ValidationError.withMessages({ local_user_id: t("link_target_invalid") });
  if (local.role === "admin") throw ValidationError.withMessages({ local_user_id: t("link_admin") });
  if (await hasHistory(api.id)) throw ValidationError.withMessages({ id: t("link_has_history") });

  const before = { api_user: { id: api.id, name: api.name, email: api.email, external_id: api.external_id }, local_user: { id: local.id, name: local.name, email: local.email, type: local.type } };
  await transaction(async () => {
    await deleteUserTokens(api.id);
    await deleteUserTokens(local.id);
    await exec("DELETE FROM notifications WHERE notifiable_type = ? AND notifiable_id = ?", ["App\\Models\\User", api.id]);
    await exec("DELETE FROM users WHERE id = ?", [api.id]);
    await update(
      "users",
      { type: "API", connection_id: api.connection_id, external_id: api.external_id, password: null, remember_token: null, external_synced_at: api.external_synced_at, updated_at: nowDb() },
      "id = ?",
      [local.id],
    );
  });
  const linked = (await findUser(local.id))!;
  await audit(req, {
    action: "api_user.linked",
    subjectType: "user",
    subjectId: local.id,
    before,
    after: { id: linked.id, name: linked.name, email: linked.email, type: linked.type, connection_id: linked.connection_id, external_id: linked.external_id },
  });
  res.json({ data: (await permissionView(linked)).user });
});

/* ---------------------------------------------------------------- audit log */

accessRoutes.get("/audit-logs", async (req, res) => {
  guard(req);
  const f = await validate(
    req.input,
    {
      action: ["nullable", "string", "max:100"],
      subject_type: ["nullable", "string", "max:50"],
      subject_id: ["nullable", "string", "max:64"],
      actor_id: ["nullable", "integer"],
      from: ["nullable", "date"],
      to: ["nullable", "date"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  const where = ["1 = 1"];
  const params: unknown[] = [];
  if (f.action) (where.push("a.action LIKE ?"), params.push(`${likeEscape(String(f.action))}%`));
  if (f.subject_type) (where.push("a.subject_type = ?"), params.push(f.subject_type));
  if (f.subject_id) (where.push("a.subject_id = ?"), params.push(f.subject_id));
  if (f.actor_id) (where.push("a.actor_id = ?"), params.push(int(f.actor_id)));
  if (f.from) (where.push("a.created_at >= ?"), params.push(`${f.from} 00:00:00`));
  if (f.to) (where.push("a.created_at <= ?"), params.push(`${f.to} 23:59:59`));
  const whereSql = where.join(" AND ");
  const total = Number(await scalar(`SELECT COUNT(*) FROM audit_logs a WHERE ${whereSql}`, params));
  const rows = await select<{ id: number; actor_id: number | null; actor_name: string | null; action: string; subject_type: string; subject_id: string | null; subject_name: string | null; before: unknown; after: unknown; ip: string | null; created_at: string }>(
    `SELECT a.*, u.name AS actor_name,
       CASE a.subject_type WHEN 'user' THEN (SELECT s.name FROM users s WHERE s.id::text = a.subject_id)
                           WHEN 'api_connection' THEN (SELECT c.name FROM api_connections c WHERE c.id::text = a.subject_id) END AS subject_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  res.json(paginated(req, rows.map((r) => ({ ...r, created_at: iso(r.created_at) })), total, page, perPage));
});

/** การกระทำทั้งหมดที่มีใน log (ใช้ทำตัวกรอง) */
accessRoutes.get("/audit-logs/actions", async (req, res) => {
  guard(req);
  const rows = await select<{ action: string }>("SELECT DISTINCT action FROM audit_logs ORDER BY action");
  res.json({ data: rows.map((r) => r.action) });
});

