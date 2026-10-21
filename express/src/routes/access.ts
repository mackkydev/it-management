import ExcelJS from "exceljs";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, localToday, nowDb } from "../lib/time.js";
import { deleteUserTokens } from "../lib/tokens.js";
import { bool, int, validate, type ErrorBag } from "../lib/validator.js";
import { me, pageParam, paginated } from "../http.js";
import { LOCKED_KEYS, MODULES, PERMISSION_KEYS, PERMISSIONS } from "../models/permission.js";
import { can, findUser, hasHistory, isSuperAdmin, ROLES, type UserRow } from "../models/user.js";
import { editableGroupKeys, grantError, groupEditError, groupKeys, lastLocalSuperAdmin, notifyAccessChange, roleChangeError, targetError } from "../services/access-control.js";
import { ADMIN_ROLES, loadConnection } from "../services/api-auth.js";
import { audit } from "../services/audit.js";
import { audiencePermissions, expiryEnabled, groupsOf, listGroups, permissionsOf, SUPER_ADMIN_GROUP } from "../services/permissions.js";
import { putSetting } from "../services/settings.js";

/**
 * สิทธิ์การใช้งาน / API User / audit log
 *   GET    /permissions                    รายการสิทธิ์ (ระบบงาน × การกระทำ) + กลุ่ม + สิทธิ์ของแต่ละกลุ่ม
 *   PUT    /permissions/roles/{group}      { keys } กำหนดสิทธิ์ทั้งชุดของกลุ่ม (access.manage / access.groups — กลุ่มที่ต่ำกว่า)
 *   POST   /permission-groups              { name_th, name_en } สร้างกลุ่ม (access.manage / access.groups)
 *   PUT    /permission-groups/{key}        { name_th, name_en } เปลี่ยนชื่อกลุ่ม (access.manage / access.groups — กลุ่มที่ต่ำกว่า)
 *   DELETE /permission-groups/{key}        ลบกลุ่มที่สร้างเอง (access.manage / access.groups — ต้องถอดสิทธิ์ทั้งหมดของกลุ่มได้)
 *   access.groups (admin): แก้ได้เฉพาะกลุ่มที่ต่ำกว่าตำแหน่งตัวเองและไม่ได้อยู่เอง (groupEditError) + สิทธิ์ที่ตัวเองมี (grantError)
 *   PUT    /permission-expiry              { enabled } สวิตช์วันหมดอายุของสิทธิ์ (access.manage)
 *   GET    /users/{id}/permissions         ตำแหน่ง + กลุ่มที่มอบเพิ่ม + เพิ่ม/ถอดรายคน + สิทธิ์จริง (access.assign)
 *   PUT    /users/{id}/permissions         { role?, groups?: [{ key, expires_on }], overrides?: { key: { effect, expires_on } | "inherit" } } (access.assign)
 *   GET    /api-users                      รายการ API User (access.assign)
 *   POST   /api-users/{id}/link            { local_user_id } ผูก API User กับบัญชี LOCAL เดิม (access.assign)
 *   GET    /audit-logs                     บันทึกการเปลี่ยนแปลง (audit_logs.view)
 * ทุกการเปลี่ยนสิทธิ์บันทึก audit_logs (ก่อน-หลัง) + แจ้งเตือนผู้ดูแลระบบสูงสุด + ผู้ดูแลระบบทุกคน
 * กติกาการมอบ (กันยกระดับสิทธิ์ตัวเอง) อยู่ที่ services/access-control.ts
 */
export const accessRoutes = Router();

const guard = (req: Request, key: string) => {
  const u = me(req);
  authorize(can(u, key));
  return u;
};

/** แก้ตารางสิทธิ์ / กลุ่มได้: access.manage (ทุกกลุ่ม) หรือ access.groups (กลุ่มที่ต่ำกว่า) */
const groupGuard = (req: Request) => {
  const u = me(req);
  authorize(can(u, "access.manage") || can(u, "access.groups"));
  return u;
};

async function target(req: Request): Promise<UserRow> {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const user = Number.isNaN(id) ? null : await findUser(id);
  if (!user) throw notFound();
  return user;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = (v: unknown): string | null => (v === null || v === undefined ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));

type Override = { effect: "allow" | "deny"; expires_on: string | null };

const overridesOf = async (userId: number) =>
  Object.fromEntries(
    (
      await select<{ key: string; effect: "allow" | "deny"; expires_on: string | null }>(
        "SELECT p.key, up.effect, up.expires_on FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ? ORDER BY p.key",
        [userId],
      )
    )
      .filter((r) => PERMISSION_KEYS.includes(r.key))
      .map((r) => [r.key, { effect: r.effect, expires_on: dateOnly(r.expires_on) }]),
  ) as Record<string, Override>;

const assignedGroupsOf = async (userId: number) =>
  (
    await select<{ group_key: string; expires_on: string | null }>(
      "SELECT ug.group_key, ug.expires_on FROM user_groups ug JOIN permission_groups g ON g.\"key\" = ug.group_key WHERE ug.user_id = ? ORDER BY g.sort_order, g.name_th",
      [userId],
    )
  ).map((r) => ({ key: r.group_key, expires_on: dateOnly(r.expires_on) }));

/** API User ที่การเชื่อมต่อ map รหัส role ไว้ → ตำแหน่งตามต้นทางอัตโนมัติ (ยกเว้นตำแหน่งผู้ดูแลระบบที่ตั้งในโปรแกรม IT) */
async function roleSynced(u: UserRow): Promise<boolean> {
  if (u.type !== "API" || u.connection_id === null) return false;
  return Boolean((await loadConnection(u.connection_id))?.field_map?.role_code);
}

export async function permissionView(u: UserRow, viewer?: UserRow, locale: import("../lib/i18n.js").Locale = "th") {
  const groups = await groupsOf(u);
  const byGroup = await audiencePermissions();
  const inherited = [...new Set(groups.flatMap((g) => byGroup[g] ?? []))].sort();
  return {
    user: { id: u.id, name: u.name, email: u.email, type: u.type, role: u.role, is_active: Boolean(u.is_active), is_it_staff: Boolean(u.is_it_staff), is_it_head: Boolean(u.is_it_head) },
    /** กลุ่มที่มีผลอยู่ (ตำแหน่ง + กลุ่มที่มอบเพิ่มที่ยังไม่หมดอายุ) */
    groups,
    /** กลุ่มที่มอบเพิ่ม (รวมที่หมดอายุแล้ว) */
    assigned_groups: await assignedGroupsOf(u.id),
    inherited,
    overrides: await overridesOf(u.id),
    effective: [...(await permissionsOf(u))].sort(),
    /** super_admin ผ่านทุกสิทธิ์ — เพิ่ม/ถอดรายคนไม่มีผล */
    is_super_admin: isSuperAdmin(u),
    /** ตำแหน่งซิงก์จากต้นทาง — แก้ได้เฉพาะตั้ง/ถอดตำแหน่งผู้ดูแลระบบ (super_admin / admin) */
    role_synced: await roleSynced(u),
    /** ผู้ที่เปิดดูแก้ผู้ใช้นี้ได้ไหม (null = ได้) */
    ...(viewer ? { locked_reason: targetError(viewer, u, locale) } : {}),
  };
}

accessRoutes.get("/permissions", async (req, res) => {
  const u = me(req);
  authorize(can(u, "access.assign") || can(u, "access.manage") || can(u, "access.groups"));
  const groups = await listGroups();
  // กลุ่มที่ผู้ดูแก้ตารางสิทธิ์ / ตั้งค่ารายกลุ่มได้ (super_admin แก้ไม่ได้ — ทุกสิทธิ์เสมอ)
  const allowed = await editableGroupKeys(u, req.locale);
  const editable = groups.map((g) => g.key).filter((k) => k !== SUPER_ADMIN_GROUP && (!allowed || allowed.has(k)));
  res.json({
    data: PERMISSIONS.map(({ key, group, module, action, name_th, name_en, locked }) => ({ key, group, module, action, name_th, name_en, locked: Boolean(locked) })),
    modules: MODULES,
    groups,
    editable_groups: editable,
    can_create_group: can(u, "access.manage") || can(u, "access.groups"),
    role_permissions: await audiencePermissions(),
    expiry_enabled: await expiryEnabled(),
  });
});

/** PUT /permissions/roles/{group} { keys: [...] } — กำหนดสิทธิ์ทั้งชุดของกลุ่ม (super_admin ผ่านทุกสิทธิ์ — แก้ไม่ได้) */
accessRoutes.put("/permissions/roles/:group", async (req, res) => {
  const u = groupGuard(req);
  const group = await first<{ key: string; name_th: string; is_system: boolean }>('SELECT "key", name_th, is_system FROM permission_groups WHERE "key" = ?', [String(req.params.group)]);
  if (!group || group.key === SUPER_ADMIN_GROUP) throw notFound();
  const blocked = await groupEditError(u, { key: group.key, is_system: Boolean(group.is_system) }, req.locale);
  if (blocked) throw ValidationError.withMessages({ keys: blocked });
  const keys = Array.isArray(req.input.keys) ? [...new Set((req.input.keys as unknown[]).map(String))] : null;
  if (!keys || keys.some((k) => !PERMISSION_KEYS.includes(k))) throw ValidationError.withMessages({ keys: trans(req.locale, "eam.access.invalid_override") });

  const before = await groupKeys(group.key);
  const changed = [...keys.filter((k) => !before.includes(k)), ...before.filter((k) => !keys.includes(k) && PERMISSION_KEYS.includes(k))];
  const err = grantError(u, changed, req.locale);
  if (err) throw ValidationError.withMessages({ keys: err });

  await transaction(async () => {
    await exec("DELETE FROM role_permissions WHERE role = ?", [group.key]);
    for (const key of keys) {
      await exec("INSERT INTO role_permissions (role, permission_id, created_at) SELECT ?, id, ? FROM permissions WHERE \"key\" = ?", [group.key, nowDb(), key]);
    }
  });
  const after = (await audiencePermissions())[group.key] ?? [];
  if (changed.length) {
    await audit(req, { action: "role.permissions_updated", subjectType: "role", subjectId: group.key, before: { keys: before.filter((k) => PERMISSION_KEYS.includes(k)).sort() }, after: { keys: after } });
    await notifyAccessChange(req, "group_permissions", { id: group.key, name: group.name_th }, { added: keys.filter((k) => !before.includes(k)), removed: before.filter((k) => !keys.includes(k)) });
  }
  res.json({ data: after });
});

/* ---------------------------------------------------------------- กลุ่มสิทธิ์ */

const groupRules = { name_th: ["required", "string", "max:100"], name_en: ["required", "string", "max:100"] };

/** ชื่อกลุ่มซ้ำ (ไม่สนตัวพิมพ์) */
async function nameTaken(errors: ErrorBag, input: Record<string, unknown>, locale: import("../lib/i18n.js").Locale, exceptKey?: string) {
  for (const col of ["name_th", "name_en"] as const) {
    const v = typeof input[col] === "string" ? (input[col] as string).trim() : "";
    if (v && (await first(`SELECT 1 FROM permission_groups WHERE LOWER(${col}) = LOWER(?) AND "key" <> ?`, [v, exceptKey ?? ""]))) errors.add(col, trans(locale, "eam.access.group_name_taken"));
  }
}

accessRoutes.post("/permission-groups", async (req, res) => {
  groupGuard(req);
  const data = await validate(req.input, groupRules, { locale: req.locale, after: ({ errors }) => nameTaken(errors, req.input, req.locale) });
  const key = `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
  const order = Number(await scalar("SELECT COALESCE(MAX(sort_order), 10) + 1 FROM permission_groups"));
  const now = nowDb();
  await exec("INSERT INTO permission_groups (\"key\", name_th, name_en, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, false, ?, ?, ?)", [
    key, String(data.name_th).trim(), String(data.name_en).trim(), order, now, now,
  ]);
  const group = (await listGroups()).find((g) => g.key === key)!;
  await audit(req, { action: "permission_group.created", subjectType: "permission_group", subjectId: key, after: { name_th: group.name_th, name_en: group.name_en } });
  await notifyAccessChange(req, "group_created", { id: key, name: group.name_th });
  res.status(201).json({ data: group });
});

accessRoutes.put("/permission-groups/:key", async (req, res) => {
  const u = groupGuard(req);
  const current = await first<{ key: string; name_th: string; name_en: string; is_system: boolean }>('SELECT "key", name_th, name_en, is_system FROM permission_groups WHERE "key" = ?', [String(req.params.key)]);
  if (!current) throw notFound();
  const blocked = await groupEditError(u, { key: current.key, is_system: Boolean(current.is_system) }, req.locale);
  if (blocked) throw ValidationError.withMessages({ name_th: blocked });
  const data = await validate(req.input, groupRules, { locale: req.locale, after: ({ errors }) => nameTaken(errors, req.input, req.locale, current.key) });
  const after = { name_th: String(data.name_th).trim(), name_en: String(data.name_en).trim() };
  await update("permission_groups", { ...after, updated_at: nowDb() }, '"key" = ?', [current.key]);
  if (after.name_th !== current.name_th || after.name_en !== current.name_en) {
    await audit(req, { action: "permission_group.updated", subjectType: "permission_group", subjectId: current.key, before: { name_th: current.name_th, name_en: current.name_en }, after });
    await notifyAccessChange(req, "group_updated", { id: current.key, name: after.name_th }, { old_name: current.name_th });
  }
  res.json({ data: (await listGroups()).find((g) => g.key === current.key) });
});

/** ลบได้เฉพาะกลุ่มที่สร้างเอง — สมาชิกหลุดจากกลุ่ม (สิทธิ์ของกลุ่มหายไปทันที) */
accessRoutes.delete("/permission-groups/:key", async (req, res) => {
  const u = groupGuard(req);
  const current = await first<{ key: string; name_th: string; name_en: string; is_system: boolean }>('SELECT "key", name_th, name_en, is_system FROM permission_groups WHERE "key" = ?', [String(req.params.key)]);
  if (!current) throw notFound();
  if (current.is_system) throw ValidationError.withMessages({ key: trans(req.locale, "eam.access.group_system") });
  const members = (await select<{ user_id: number }>("SELECT user_id FROM user_groups WHERE group_key = ?", [current.key])).map((r) => Number(r.user_id));
  const keys = await groupKeys(current.key);
  // ลบกลุ่ม = ถอดสิทธิ์ทั้งหมดของกลุ่มจากสมาชิก — ต้องเป็นสิทธิ์ที่ผู้ลบถอดได้
  const blocked = (await groupEditError(u, { key: current.key, is_system: false }, req.locale)) ?? grantError(u, keys, req.locale);
  if (blocked) throw ValidationError.withMessages({ key: blocked });
  await transaction(async () => {
    await exec("DELETE FROM role_permissions WHERE role = ?", [current.key]);
    await exec('DELETE FROM permission_groups WHERE "key" = ?', [current.key]);
  });
  await audit(req, { action: "permission_group.deleted", subjectType: "permission_group", subjectId: current.key, before: { name_th: current.name_th, name_en: current.name_en, keys, members } });
  await notifyAccessChange(req, "group_deleted", { id: current.key, name: current.name_th }, { members: members.length });
  res.status(204).end();
});

/** PUT /permission-expiry { enabled } — เปิด/ปิดวันหมดอายุของสิทธิ์ (ปิด = ไม่สนใจวันหมดอายุทั้งหมด; วันที่ตั้งไว้ยังเก็บไว้) */
accessRoutes.put("/permission-expiry", async (req, res) => {
  const u = guard(req, "access.manage");
  const data = await validate(req.input, { enabled: ["required", "boolean"] }, { locale: req.locale });
  const before = await expiryEnabled();
  const enabled = bool(data.enabled);
  await putSetting("permission_expiry", { enabled }, u.id);
  if (before !== enabled) {
    await audit(req, { action: "settings.permission_expiry_updated", subjectType: "settings", subjectId: "permission_expiry", before: { enabled: before }, after: { enabled } });
    await notifyAccessChange(req, "expiry", { id: "permission_expiry", name: "" }, { enabled });
  }
  res.json({ data: { enabled } });
});

/* ---------------------------------------------------------------- สิทธิ์รายคน */

accessRoutes.get("/users/:id/permissions", async (req, res) => {
  const u = guard(req, "access.assign");
  res.json({ data: await permissionView(await target(req), u, req.locale) });
});

/**
 * PUT /users/{id}/permissions — ส่งเฉพาะส่วนที่จะเปลี่ยน:
 *   role       ตำแหน่ง — API User ที่ซิงก์ตำแหน่งจากต้นทาง: ตั้ง/ถอดได้เฉพาะตำแหน่งผู้ดูแลระบบ (super_admin / admin)
 *   groups     กลุ่มที่มอบเพิ่มทั้งชุด [{ key, expires_on }] (ไม่รวมกลุ่มตามตำแหน่ง / super_admin)
 *   overrides  { key: { effect: allow|deny, expires_on } | "allow" | "deny" | "inherit" } — ส่งเฉพาะ key ที่เปลี่ยน
 */
accessRoutes.put("/users/:id/permissions", async (req, res) => {
  const u = guard(req, "access.assign");
  const t = await target(req);
  const input = req.input;
  const loc = req.locale;
  const tr = (k: string, r: Record<string, string | number> = {}) => trans(loc, `eam.access.${k}`, r);
  const synced = await roleSynced(t);
  const today = localToday();
  const allGroups = new Map((await listGroups()).map((g) => [g.key, g]));
  const currentGroups = await assignedGroupsOf(t.id);
  const currentOverrides = await overridesOf(t.id);

  // แปลง input → ชุดกลุ่ม / override ที่ต้องการ
  const wantGroups: { key: string; expires_on: string | null }[] | null = Array.isArray(input.groups)
    ? (input.groups as unknown[]).map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>) : { key: g })).map((g) => ({
        key: String(g.key ?? ""),
        expires_on: g.expires_on === null || g.expires_on === undefined || g.expires_on === "" ? null : String(g.expires_on),
      }))
    : null;
  const wantOverrides: Record<string, Override | "inherit"> = {};
  const rawOverrides = input.overrides;

  await validate(
    input,
    { role: ["sometimes", `in:${ROLES.join(",")}`], groups: ["sometimes", "nullable"], overrides: ["sometimes", "nullable"] },
    {
      locale: loc,
      after: async ({ errors }) => {
        const blocked = targetError(u, t, loc);
        if (blocked) return errors.add("user", blocked);
        if ("role" in input && input.role !== t.role) {
          const next = String(input.role) as UserRow["role"];
          if (synced && !ADMIN_ROLES.includes(next) && !ADMIN_ROLES.includes(t.role)) errors.add("role", trans(loc, "eam.api_connection.role_synced"));
          else {
            const e = await roleChangeError(u, t, next, loc);
            if (e) errors.add("role", e);
          }
        }
        if ("groups" in input && input.groups !== null && !Array.isArray(input.groups)) errors.add("groups", tr("invalid_group"));
        for (const [i, g] of (wantGroups ?? []).entries()) {
          const def = allGroups.get(g.key);
          if (!def || g.key === SUPER_ADMIN_GROUP) errors.add(`groups.${i}.key`, tr("invalid_group"));
          else if (g.expires_on !== null && (!ISO_DATE.test(g.expires_on) || Number.isNaN(Date.parse(g.expires_on)))) errors.add(`groups.${i}.expires_on`, tr("invalid_date"));
          else if (g.expires_on !== null && g.expires_on < today && currentGroups.find((c) => c.key === g.key)?.expires_on !== g.expires_on) errors.add(`groups.${i}.expires_on`, tr("expires_past"));
        }
        if (wantGroups && new Set(wantGroups.map((g) => g.key)).size !== wantGroups.length) errors.add("groups", tr("invalid_group"));
        if (rawOverrides !== undefined && rawOverrides !== null) {
          if (typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) return errors.add("overrides", tr("invalid_override"));
          for (const [key, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
            const o = typeof v === "string" ? { effect: v, expires_on: null } : v && typeof v === "object" ? (v as Record<string, unknown>) : { effect: "" };
            const effect = String(o.effect ?? "");
            const exp = o.expires_on === null || o.expires_on === undefined || o.expires_on === "" ? null : String(o.expires_on);
            if (!PERMISSION_KEYS.includes(key) || !["allow", "deny", "inherit"].includes(effect)) errors.add(`overrides.${key}`, tr("invalid_override"));
            else if (exp !== null && (!ISO_DATE.test(exp) || Number.isNaN(Date.parse(exp)))) errors.add(`overrides.${key}`, tr("invalid_date"));
            else if (exp !== null && exp < today && currentOverrides[key]?.expires_on !== exp) errors.add(`overrides.${key}`, tr("expires_past"));
            else wantOverrides[key] = effect === "inherit" ? "inherit" : { effect: effect as "allow" | "deny", expires_on: exp };
          }
        }
        if (!errors.empty) return;
        // มอบ/ถอดได้เฉพาะสิทธิ์ที่ตัวเองมี (และไม่ใช่สิทธิ์ที่สงวนไว้) — นับเฉพาะส่วนที่เปลี่ยนจริง
        if (wantGroups) {
          const touched = [
            ...wantGroups.filter((g) => JSON.stringify(currentGroups.find((c) => c.key === g.key)) !== JSON.stringify(g)).map((g) => g.key),
            ...currentGroups.filter((c) => !wantGroups.some((g) => g.key === c.key)).map((c) => c.key),
          ];
          const keys = (await Promise.all(touched.map(groupKeys))).flat();
          const e = grantError(u, keys, loc);
          if (e) errors.add("groups", e);
        }
        const touchedKeys = Object.entries(wantOverrides)
          .filter(([k, v]) => JSON.stringify(v === "inherit" ? undefined : v) !== JSON.stringify(currentOverrides[k]))
          .map(([k]) => k);
        const e = grantError(u, touchedKeys, loc);
        if (e) errors.add("overrides", e);
      },
    },
  );

  const before = { role: t.role, groups: currentGroups, overrides: currentOverrides };
  await transaction(async () => {
    if ("role" in input && input.role !== t.role) await update("users", { role: input.role, updated_at: nowDb() }, "id = ?", [t.id]);
    if (wantGroups) {
      // คงผู้มอบ/เวลามอบของกลุ่มเดิม — แก้แค่วันหมดอายุ; กลุ่มที่เอาออก = ลบ, กลุ่มใหม่ = เพิ่ม
      const removed = currentGroups.filter((c) => !wantGroups.some((g) => g.key === c.key)).map((c) => c.key);
      if (removed.length) await exec("DELETE FROM user_groups WHERE user_id = ? AND group_key IN (?)", [t.id, removed]);
      for (const g of wantGroups) {
        const prev = currentGroups.find((c) => c.key === g.key);
        if (prev) {
          if (prev.expires_on !== g.expires_on) await exec("UPDATE user_groups SET expires_on = ? WHERE user_id = ? AND group_key = ?", [g.expires_on, t.id, g.key]);
        } else await exec("INSERT INTO user_groups (user_id, group_key, expires_on, created_by, created_at) VALUES (?, ?, ?, ?, ?)", [t.id, g.key, g.expires_on, u.id, nowDb()]);
      }
    }
    for (const [key, v] of Object.entries(wantOverrides)) {
      const pid = await scalar<number>('SELECT id FROM permissions WHERE "key" = ?', [key]);
      if (pid === null) continue;
      if (v === "inherit") await exec("DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?", [t.id, pid]);
      else
        await exec(
          `INSERT INTO user_permissions (user_id, permission_id, effect, expires_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
           AS new ON DUPLICATE KEY UPDATE effect = new.effect, expires_on = new.expires_on, created_by = new.created_by, created_at = new.created_at`,
          [t.id, pid, v.effect, v.expires_on, u.id, nowDb()],
        );
    }
  });
  const fresh = (await findUser(t.id))!;
  const after = { role: fresh.role, groups: await assignedGroupsOf(t.id), overrides: await overridesOf(t.id) };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await audit(req, { action: "user.permissions_updated", subjectType: "user", subjectId: t.id, before, after });
    await notifyAccessChange(req, "user", { id: t.id, name: t.name }, { role: before.role !== after.role ? after.role : undefined });
  }
  res.json({ data: await permissionView(fresh, u, req.locale) });
});

/* ---------------------------------------------------------------- สมาชิกกลุ่ม / รายงานสิทธิ์พิเศษรายคน (หน้า /access-review) */

/**
 * GET    /permission-groups/{key}/members          สมาชิกที่มอบเพิ่ม (user_groups) + ผู้ที่อยู่ตามตำแหน่ง (กลุ่มตามตำแหน่ง — อ่านอย่างเดียว) (access.assign)
 * POST   /permission-groups/{key}/members          { user_ids, expires_on } เพิ่มสมาชิก (ข้ามคนที่อยู่แล้ว)
 * PATCH  /permission-groups/{key}/members/{user}   { expires_on } แก้วันหมดอายุ
 * DELETE /permission-groups/{key}/members/{user}   เอาออกจากกลุ่ม
 * GET    /access-exceptions                        ทุกการมอบรายคน: กลุ่มที่มอบเพิ่ม + อนุญาต/ไม่อนุญาตรายข้อ (ผู้มอบ / วันหมดอายุ / ยกเลิกได้ไหม)
 * กติกาเดียวกับหน้าสิทธิ์รายคน: แก้ตัวเอง / บัญชี super_admin ไม่ได้ (targetError), มอบ/ถอดได้เฉพาะสิทธิ์ที่ตัวเองมี (grantError)
 * — ทุกการเปลี่ยน audit user.permissions_updated (ก่อน-หลังของผู้ใช้คนนั้น) + แจ้งเตือนผู้ดูแลระบบ
 */
type MemberRow = {
  user_id: number;
  name: string;
  email: string | null;
  role: string;
  department: string | null;
  is_active: boolean;
  branch: string | null;
  expires_on: string | null;
  created_at: string | null;
  creator_id: number | null;
  creator_name: string | null;
};

async function findGroup(key: string) {
  const g = (await listGroups()).find((x) => x.key === key);
  if (!g || g.key === SUPER_ADMIN_GROUP) throw notFound();
  return g;
}

/** เพิ่ม / แก้วันหมดอายุ / เอาออก (expires = undefined) — คืนข้อความผิดพลาด (null = ทำแล้ว หรือไม่มีอะไรเปลี่ยน) */
async function changeMembership(req: Request, actor: UserRow, user: UserRow, key: string, expires: string | null | undefined): Promise<string | null> {
  const loc = req.locale;
  const blocked = targetError(actor, user, loc) ?? grantError(actor, await groupKeys(key), loc);
  if (blocked) return blocked;
  const before = await assignedGroupsOf(user.id);
  const current = before.find((g) => g.key === key);
  if (expires === undefined) {
    if (!current) return null;
    await exec("DELETE FROM user_groups WHERE user_id = ? AND group_key = ?", [user.id, key]);
  } else if (current) {
    if (current.expires_on === expires) return null;
    await exec("UPDATE user_groups SET expires_on = ? WHERE user_id = ? AND group_key = ?", [expires, user.id, key]);
  } else {
    await exec("INSERT INTO user_groups (user_id, group_key, expires_on, created_by, created_at) VALUES (?, ?, ?, ?, ?)", [user.id, key, expires, actor.id, nowDb()]);
  }
  const overrides = await overridesOf(user.id);
  await audit(req, {
    action: "user.permissions_updated",
    subjectType: "user",
    subjectId: user.id,
    before: { role: user.role, groups: before, overrides },
    after: { role: user.role, groups: await assignedGroupsOf(user.id), overrides },
  });
  await notifyAccessChange(req, "user", { id: user.id, name: user.name });
  return null;
}

/** วันหมดอายุจาก input ("" / null = ไม่หมดอายุ) — ย้อนหลังไม่ได้ ยกเว้นเป็นค่าเดิม */
function expiresInput(req: Request, value: unknown, current: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = String(value);
  if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) throw ValidationError.withMessages({ expires_on: trans(req.locale, "eam.access.invalid_date") });
  if (v < localToday() && v !== current) throw ValidationError.withMessages({ expires_on: trans(req.locale, "eam.access.expires_past") });
  return v;
}

accessRoutes.get("/permission-groups/:key/members", async (req, res) => {
  const u = guard(req, "access.assign");
  const group = await findGroup(String(req.params.key));
  const rows = await select<MemberRow>(
    `SELECT u.id AS user_id, u.name, u.email, u.role, u.department, u.is_active, b.name AS branch, ug.expires_on, ug.created_at, c.id AS creator_id, c.name AS creator_name
       FROM user_groups ug JOIN users u ON u.id = ug.user_id
       LEFT JOIN branches b ON b.id = u.branch_id LEFT JOIN users c ON c.id = ug.created_by
      WHERE ug.group_key = ? ORDER BY u.name, u.id`,
    [group.key],
  );
  const byRole = (ROLES as readonly string[]).includes(group.key)
    ? await select<{ id: number; name: string; email: string | null; department: string | null; branch: string | null }>(
        `SELECT u.id, u.name, u.email, u.department, b.name AS branch FROM users u LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.role = ? AND u.is_active = true ORDER BY u.name, u.id LIMIT 1000`,
        [group.key],
      )
    : [];
  const canManage = grantError(u, await groupKeys(group.key), req.locale) === null;
  const today = localToday();
  const assigned = new Set(rows.map((r) => Number(r.user_id)));
  const editable = (id: number, role: string) => targetError(u, { id, role: role as UserRow["role"] }, req.locale) === null;
  const options = canManage
    ? (await select<{ id: number; name: string; department: string | null; role: string }>("SELECT id, name, department, role FROM users WHERE is_active = true ORDER BY name LIMIT 2000"))
        .filter((x) => !assigned.has(Number(x.id)) && editable(Number(x.id), x.role))
        .map((x) => ({ id: Number(x.id), name: x.department ? `${x.name} (${x.department})` : x.name }))
    : [];
  res.json({
    data: {
      group: { key: group.key, name_th: group.name_th, name_en: group.name_en, is_system: group.is_system },
      members: rows.map((r) => ({
        user: { id: Number(r.user_id), name: r.name, email: r.email, role: r.role, department: r.department, branch: r.branch, is_active: Boolean(r.is_active) },
        expires_on: dateOnly(r.expires_on),
        expired: r.expires_on !== null && dateOnly(r.expires_on)! < today,
        granted_by: r.creator_id ? { id: Number(r.creator_id), name: r.creator_name } : null,
        granted_at: iso(r.created_at),
        can_edit: canManage && editable(Number(r.user_id), r.role),
      })),
      // ผู้ที่อยู่กลุ่มนี้เพราะตำแหน่ง (กลุ่มตามตำแหน่ง) — เปลี่ยนที่หน้าผู้ใช้
      role_members: byRole.map((r) => ({ id: Number(r.id), name: r.name, email: r.email, department: r.department, branch: r.branch })),
      can_manage: canManage,
      // ผู้ใช้ที่เพิ่มได้: ใช้งานอยู่ ยังไม่อยู่ในกลุ่ม ไม่ใช่ตัวเอง (และไม่ใช่ super_admin ถ้าผู้ทำไม่ใช่ super_admin)
      user_options: options,
      expiry_enabled: await expiryEnabled(),
    },
  });
});

accessRoutes.post("/permission-groups/:key/members", async (req, res) => {
  const u = guard(req, "access.assign");
  const group = await findGroup(String(req.params.key));
  const data = await validate(req.input, { user_ids: ["required", "array", "min:1", "max:200"], "user_ids.*": ["integer"] }, { locale: req.locale });
  const expires = expiresInput(req, req.input.expires_on, undefined);
  const ids = [...new Set(Object.values(data.user_ids as Record<string, unknown>).map(Number))];
  const failed: string[] = [];
  let added = 0;
  for (const id of ids) {
    const user = await findUser(id);
    if (!user || !user.is_active) {
      failed.push(trans(req.locale, "eam.access.invalid_user"));
      continue;
    }
    if ((await assignedGroupsOf(id)).some((g) => g.key === group.key)) continue;
    const e = await changeMembership(req, u, user, group.key, expires);
    if (e) failed.push(`${user.name}: ${e}`);
    else added++;
  }
  if (failed.length && added === 0) throw ValidationError.withMessages({ user_ids: failed });
  res.status(201).json({ data: { added, failed } });
});

async function memberTarget(req: Request) {
  const u = guard(req, "access.assign");
  const group = await findGroup(String(req.params.key));
  const user = /^\d+$/.test(String(req.params.user)) ? await findUser(Number(req.params.user)) : null;
  const current = user ? (await assignedGroupsOf(user.id)).find((g) => g.key === group.key) : undefined;
  if (!user || !current) throw notFound();
  return { u, group, user, current };
}

accessRoutes.patch("/permission-groups/:key/members/:user", async (req, res) => {
  const { u, group, user, current } = await memberTarget(req);
  const expires = expiresInput(req, req.input.expires_on, current.expires_on);
  const e = await changeMembership(req, u, user, group.key, expires);
  if (e) throw ValidationError.withMessages({ user: e });
  res.status(204).end();
});

accessRoutes.delete("/permission-groups/:key/members/:user", async (req, res) => {
  const { u, group, user } = await memberTarget(req);
  const e = await changeMembership(req, u, user, group.key, undefined);
  if (e) throw ValidationError.withMessages({ user: e });
  res.status(204).end();
});

type ExceptionSource = {
  user_id: number;
  key: string;
  kind: "group" | "allow" | "deny";
  expires_on: string | null;
  created_at: string | null;
  creator_id: number | null;
  creator_name: string | null;
};

accessRoutes.get("/access-exceptions", async (req, res) => {
  const u = guard(req, "access.assign");
  const loc = req.locale;
  const groups = new Map((await listGroups()).map((g) => [g.key, g]));
  const sources: ExceptionSource[] = [
    ...(
      await select<Omit<ExceptionSource, "kind"> & { kind: string }>(
        `SELECT ug.user_id, ug.group_key AS "key", 'group' AS kind, ug.expires_on, ug.created_at, c.id AS creator_id, c.name AS creator_name
           FROM user_groups ug LEFT JOIN users c ON c.id = ug.created_by`,
      )
    ).map((r) => ({ ...r, kind: "group" as const })),
    ...(
      await select<Omit<ExceptionSource, "kind"> & { kind: string }>(
        `SELECT up.user_id, p."key", up.effect AS kind, up.expires_on, up.created_at, c.id AS creator_id, c.name AS creator_name
           FROM user_permissions up JOIN permissions p ON p.id = up.permission_id LEFT JOIN users c ON c.id = up.created_by`,
      )
    ).map((r) => ({ ...r, kind: (r.kind === "deny" ? "deny" : "allow") as "allow" | "deny" })),
  ];
  const userIds = [...new Set(sources.map((r) => Number(r.user_id)))];
  const users = new Map(
    (userIds.length
      ? await select<{ id: number; name: string; email: string | null; role: string; department: string | null; is_active: boolean }>(
          "SELECT id, name, email, role, department, is_active FROM users WHERE id IN (?)",
          [userIds],
        )
      : []
    ).map((x) => [Number(x.id), x]),
  );
  const groupKeyCache = new Map<string, string[]>();
  const keysOf = async (key: string) => {
    if (!groupKeyCache.has(key)) groupKeyCache.set(key, await groupKeys(key));
    return groupKeyCache.get(key)!;
  };
  const perms = new Map(PERMISSIONS.map((p) => [p.key, p]));
  const today = localToday();
  const items = [];
  for (const r of sources) {
    const user = users.get(Number(r.user_id));
    const def = r.kind === "group" ? groups.get(r.key) : perms.get(r.key);
    if (!user || !def) continue;
    const blocked =
      targetError(u, { id: Number(user.id), role: user.role as UserRow["role"] }, loc) ?? grantError(u, r.kind === "group" ? await keysOf(r.key) : [r.key], loc);
    const expires = dateOnly(r.expires_on);
    items.push({
      kind: r.kind,
      key: r.key,
      name_th: def.name_th,
      name_en: def.name_en,
      user: { id: Number(user.id), name: user.name, email: user.email, role: user.role, department: user.department, is_active: Boolean(user.is_active) },
      expires_on: expires,
      expired: expires !== null && expires < today,
      granted_by: r.creator_id ? { id: Number(r.creator_id), name: r.creator_name } : null,
      granted_at: iso(r.created_at),
      can_revoke: blocked === null,
    });
  }
  items.sort((a, b) => a.user.name.localeCompare(b.user.name, "th") || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  res.json({ data: items, expiry_enabled: await expiryEnabled() });
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
  external_status: string | null;
  created_at: string | null;
  connection_id: number;
  connection_name: string;
  overrides_count: number;
  conflict_email: string | null;
  conflict_user_id: number | null;
}

accessRoutes.get("/api-users", async (req, res) => {
  guard(req, "access.assign");
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      role: ["nullable", `in:${ROLES.join(",")}`],
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
    where.push("(u.name LIKE ? OR u.email LIKE ? OR u.external_id LIKE ?)");
    params.push(`%${esc}%`, `%${esc}%`, `${esc}%`);
  }
  if (f.role) (where.push("u.role = ?"), params.push(f.role));
  if (f.status) (where.push("u.is_active = ?"), params.push(f.status === "active"));
  if (f.connection_id) (where.push("u.connection_id = ?"), params.push(int(f.connection_id)));
  // อีเมลจากต้นทางซ้ำกับผู้ใช้อื่นที่ยังมีอยู่ และยังไม่ได้ใช้อีเมลนั้น — รอ admin ผูกบัญชี
  const conflict = `(SELECT a.after->>'$.email' FROM audit_logs a WHERE a.action = 'api_user.email_conflict' AND a.subject_type = 'user' AND a.subject_id = CAST(u.id AS CHAR)
      AND EXISTS (SELECT 1 FROM users o WHERE LOWER(o.email) = LOWER(a.after->>'$.email') AND o.id <> u.id) ORDER BY a.id DESC LIMIT 1)`;
  if (bool(f.conflict)) where.push(`${conflict} IS NOT NULL`);
  const whereSql = where.join(" AND ");

  const total = Number(await scalar(`SELECT COUNT(*) FROM users u WHERE ${whereSql}`, params));
  const rows = await select<ApiUserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.external_id, u.external_synced_at, u.external_status, u.created_at, u.connection_id,
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
 * บัญชี super_admin ผูกได้เฉพาะผู้ดูแลระบบ และห้ามผูก super_admin บัญชี LOCAL คนสุดท้าย (ทางสำรองเมื่อต้นทางล่ม)
 */
accessRoutes.post("/api-users/:id/link", async (req, res) => {
  const actor = guard(req, "access.assign");
  const api = await target(req);
  const data = await validate(req.input, { local_user_id: ["required", "integer"] }, { locale: req.locale });
  const local = await findUser(Number(data.local_user_id));
  const t = (key: string) => trans(req.locale, `eam.access.${key}`);
  if (api.type !== "API") throw ValidationError.withMessages({ id: t("not_api_user") });
  if (!local || local.type !== "LOCAL" || local.id === api.id) throw ValidationError.withMessages({ local_user_id: t("link_target_invalid") });
  if (local.role === SUPER_ADMIN_GROUP && (!isSuperAdmin(actor) || (await lastLocalSuperAdmin(local)))) throw ValidationError.withMessages({ local_user_id: t("link_admin") });
  if (local.id === actor.id) throw ValidationError.withMessages({ local_user_id: t("self_change") });
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
  res.json({ data: (await permissionView(linked, actor)).user });
});

/* ---------------------------------------------------------------- audit log */

/** ตัวกรองบันทึกการเปลี่ยนแปลง — ใช้ร่วมกันระหว่างหน้ารายการและไฟล์ Excel */
async function auditFilter(req: Request, input: Record<string, unknown>) {
  const f = await validate(
    input,
    {
      action: ["nullable", "string", "max:100"],
      subject_type: ["nullable", "string", "max:50"],
      subject_id: ["nullable", "string", "max:64"],
      actor_id: ["nullable", "integer"],
      // ผู้ทำ: พิมพ์ชื่อ / ชื่อผู้ใช้ / อีเมล (บางส่วนได้)
      actor: ["nullable", "string", "max:100"],
      // สาขาของผู้ทำ
      branch_id: ["nullable", "integer"],
      from: ["nullable", "date"],
      to: ["nullable", "date"],
    },
    { locale: req.locale },
  );
  const where = ["1 = 1"];
  const params: unknown[] = [];
  if (f.action) (where.push("a.action LIKE ?"), params.push(`${likeEscape(String(f.action))}%`));
  if (f.subject_type) (where.push("a.subject_type = ?"), params.push(f.subject_type));
  if (f.subject_id) (where.push("a.subject_id = ?"), params.push(f.subject_id));
  if (f.actor_id) (where.push("a.actor_id = ?"), params.push(int(f.actor_id)));
  const actor = String(f.actor ?? "").trim();
  if (actor) {
    const like = `%${likeEscape(actor)}%`;
    where.push("(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)");
    params.push(like, like, like);
  }
  if (f.branch_id) (where.push("u.branch_id = ?"), params.push(int(f.branch_id)));
  if (f.from) (where.push("a.created_at >= ?"), params.push(`${f.from} 00:00:00`));
  if (f.to) (where.push("a.created_at <= ?"), params.push(`${f.to} 23:59:59`));
  return { sql: where.join(" AND "), params };
}

interface AuditRow {
  id: number; actor_id: number | null; actor_name: string | null; branch_name: string | null; action: string; subject_type: string; subject_id: string | null;
  subject_name: string | null; before: unknown; after: unknown; ip: string | null; created_at: string;
}

const AUDIT_SELECT = `SELECT a.*, u.name AS actor_name, b.name AS branch_name,
       CASE a.subject_type WHEN 'user' THEN (SELECT s.name FROM users s WHERE CAST(s.id AS CHAR) = a.subject_id)
                           WHEN 'api_connection' THEN (SELECT c.name FROM api_connections c WHERE CAST(c.id AS CHAR) = a.subject_id) END AS subject_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN branches b ON b.id = u.branch_id`;

accessRoutes.get("/audit-logs", async (req, res) => {
  guard(req, "audit_logs.view");
  const f = await validate(req.input, { per_page: ["nullable", "integer", "min:1", "max:100"] }, { locale: req.locale });
  const w = await auditFilter(req, req.input);
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  const total = Number(await scalar(`SELECT COUNT(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${w.sql}`, w.params));
  const rows = await select<AuditRow>(`${AUDIT_SELECT} WHERE ${w.sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...w.params, perPage, (page - 1) * perPage]);
  res.json(paginated(req, rows.map((r) => ({ ...r, created_at: iso(r.created_at) })), total, page, perPage));
});

const AUDIT_EXPORT_MAX = 20000;
const auditValue = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const asObject = (v: unknown): Record<string, unknown> | null => {
  const o = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
};

/**
 * POST /audit-logs/export { ...ตัวกรอง, labels: { [action]: ชื่อที่แสดง } } → Excel (ล่าสุดก่อน สูงสุด 20,000 แถว)
 * ชื่อการกระทำแปลที่หน้าเว็บ (พจนานุกรมอยู่ฝั่ง frontend) จึงส่งมาพร้อมคำขอ
 */
accessRoutes.post("/audit-logs/export", async (req, res) => {
  guard(req, "audit_logs.view");
  const w = await auditFilter(req, req.input);
  const labels = asObject(req.input.labels) ?? {};
  const head = asObject(req.input.headers) ?? {};
  const rows = await select<AuditRow>(`${AUDIT_SELECT} WHERE ${w.sql} ORDER BY a.id DESC LIMIT ?`, [...w.params, AUDIT_EXPORT_MAX]);
  const when = new Intl.DateTimeFormat(req.locale === "th" ? "th-TH" : "en-GB", {
    timeZone: config.localTimezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const h = (k: string, fallback: string) => (typeof head[k] === "string" ? String(head[k]) : fallback);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(h("sheet", "Audit log"));
  ws.columns = [
    { header: h("time", "Time"), key: "time", width: 22 },
    { header: h("actor", "By"), key: "actor", width: 26 },
    { header: h("branch", "Branch"), key: "branch", width: 18 },
    { header: h("action", "Action"), key: "action", width: 34 },
    { header: h("subject", "Item"), key: "subject", width: 30 },
    { header: h("changes", "Changes"), key: "changes", width: 70 },
    { header: "IP", key: "ip", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    const before = asObject(r.before);
    const after = asObject(r.after);
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
      (k) => !before || !after || JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    const row = ws.addRow({
      time: when.format(new Date(iso(r.created_at)!)),
      actor: r.actor_name ?? h("system", "System"),
      branch: r.branch_name ?? "",
      action: typeof labels[r.action] === "string" ? labels[r.action] : r.action,
      subject: `${r.subject_name ?? r.subject_type}${r.subject_id ? ` #${r.subject_id}` : ""}`,
      changes: keys.map((k) => `${k}: ${auditValue(before?.[k])} → ${auditValue(after?.[k])}`).join("\n"),
      ip: r.ip ?? "",
    });
    row.getCell("changes").alignment = { wrapText: true, vertical: "top" };
    row.alignment = { vertical: "top" };
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${localToday()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/** การกระทำทั้งหมดที่มีใน log (ใช้ทำตัวกรอง) */
accessRoutes.get("/audit-logs/actions", async (req, res) => {
  guard(req, "audit_logs.view");
  const rows = await select<{ action: string }>("SELECT DISTINCT action FROM audit_logs ORDER BY action");
  res.json({ data: rows.map((r) => r.action) });
});

