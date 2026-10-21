import { Router, type Request } from "express";
import { config } from "../config.js";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans, type Locale } from "../lib/i18n.js";
import { decryptVaultNullable, encryptVaultNullable } from "../services/vault-crypto.js";
import { limits } from "../lib/rate-limit.js";
import { dateOnly, diffInDays, fromDbDate, iso, nowDb } from "../lib/time.js";
import { bool, custom, exists, int, makeHash, regex, unique, validate } from "../lib/validator.js";
import { audit } from "../services/audit.js";
import { passwordPolicy } from "../services/password-policy.js";
import { BUILTIN_CATEGORIES } from "../services/categories.js";
import { editableGroupKeys, keepLockedHidden, notifyAccessChange } from "../services/access-control.js";
import { me, shortMeta, pageParam } from "../http.js";
import { can, type UserRow } from "../models/user.js";
import { audiencePermissions, groupsOf, usersWithPermissions } from "../services/permissions.js";
import { assertCanReveal, centralPin, centralPinStatus, isValidIpEntry, notifyReveal, PIN_PATTERN, pinSetAt, secretGuard, verifyLoginPassword, revealRecipients } from "../services/secret-guard.js";
import { allSettings, getSetting, putSetting } from "../services/settings.js";

/** IT-SYSTEM: สาขา, ตั้งค่า, แจ้งเตือนในระบบ, คลังบัญชี/รหัสผ่าน, สัญญา vendor */
export const itDataRoutes = Router();

/** กลุ่มผู้ใช้ในหน้าสิทธิ์การใช้งาน (frontend: lib/permissions.ts) */

const routeId = (req: Request) => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN);
/** ต้องมีสิทธิ์อย่างน้อยหนึ่งข้อของระบบงาน (เช่น vault.view หรือ vault.update สำหรับหน้าแก้ไข) */
const vault = (req: Request, ...actions: ("view" | "create" | "update" | "delete")[]) => authorize(actions.some((a) => can(me(req), `vault.${a}`)));
const contracts = (req: Request, ...actions: ("view" | "create" | "update" | "delete")[]) => authorize(actions.some((a) => can(me(req), `contracts.${a}`)));
const branches = (req: Request) => authorize(can(me(req), "branches.manage"));
const settings = (req: Request) => authorize(can(me(req), "settings.manage"));

/* ================================================================ 5.1 สาขา */

interface BranchRow { id: number; code: string; name: string; work_group: string | null; sort_order: number; is_active: number; users_count?: number; tickets_count?: number }

/** array_filter(... !== null) — ไม่ส่ง users_count/tickets_count ถ้าไม่ได้นับ */
const branchJson = (b: BranchRow) => ({
  id: b.id,
  code: b.code,
  name: b.name,
  work_group: b.work_group,
  sort_order: Number(b.sort_order),
  is_active: Boolean(Number(b.is_active)),
  ...(b.users_count !== undefined ? { users_count: Number(b.users_count) } : {}),
  ...(b.tickets_count !== undefined ? { tickets_count: Number(b.tickets_count) } : {}),
});

async function findBranch(req: Request): Promise<BranchRow> {
  const b = await first<BranchRow>("SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL", [routeId(req)]);
  if (!b) throw notFound();
  return b;
}

async function branchInput(req: Request, current: BranchRow | null) {
  const s = current ? ["sometimes"] : [];
  const data = await validate(
    req.input,
    {
      code: [...s, "required", "string", "max:30", regex(/^[A-Za-z0-9\-_]+$/), unique("branches", "code", current?.id)],
      name: [...s, "required", "string", "max:255"],
      // Work Group ของ Windows (เช่น LAMPHUN) — ใช้จับคู่สาขาตอน import ทะเบียนคอมพิวเตอร์
      work_group: ["sometimes", "nullable", "string", "max:50", regex(/^[A-Za-z0-9._-]+$/), unique("branches", "work_group", current?.id)],
      sort_order: ["sometimes", "integer", "min:0", "max:9999"],
      is_active: ["sometimes", "boolean"],
    },
    { locale: req.locale },
  );
  const out: Record<string, unknown> = {};
  if ("code" in data) out.code = data.code;
  if ("name" in data) out.name = data.name;
  if ("work_group" in data) out.work_group = data.work_group ? String(data.work_group).trim().toUpperCase() : null;
  if ("sort_order" in data) out.sort_order = int(data.sort_order);
  if ("is_active" in data) out.is_active = bool(data.is_active);
  return out;
}

/** GET /branches — ทุกคนดูได้ (ใช้ในฟอร์มแจ้งงาน); ?include_inactive=1 (สิทธิ์ branches.manage) = รวมที่ปิด + จำนวนผู้ใช้/ใบแจ้งงาน */
itDataRoutes.get("/branches", async (req, res) => {
  const manage = bool(req.query.include_inactive) && can(me(req), "branches.manage");
  const rows = await select<BranchRow>(
    manage
      ? `SELECT b.*, (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id) AS users_count,
           (SELECT COUNT(*) FROM it_tickets t WHERE t.branch_id = b.id) AS tickets_count
           FROM branches b WHERE b.deleted_at IS NULL ORDER BY b.sort_order, b.name`
      : "SELECT * FROM branches WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, name",
  );
  res.json({ data: rows.map(branchJson) });
});

itDataRoutes.post("/branches", async (req, res) => {
  branches(req);
  const data = await branchInput(req, null);
  const now = nowDb();
  const id = await insert("branches", { ...data, created_at: now, updated_at: now });
  res.status(201).json({ data: branchJson((await first<BranchRow>("SELECT * FROM branches WHERE id = ?", [id]))!) });
});

async function updateBranch(req: Request, res: import("express").Response) {
  const b = await findBranch(req);
  branches(req);
  const data = await branchInput(req, b);
  await update("branches", { ...data, updated_at: nowDb() }, "id = ?", [b.id]);
  res.json({ data: branchJson((await first<BranchRow>("SELECT * FROM branches WHERE id = ?", [b.id]))!) });
}
itDataRoutes.put("/branches/:id", updateBranch);
itDataRoutes.patch("/branches/:id", updateBranch);

/** ลบได้เฉพาะสาขาที่ไม่มีผู้ใช้และใบแจ้งงาน — มิฉะนั้นให้ปิดใช้งานแทน */
itDataRoutes.delete("/branches/:id", async (req, res) => {
  const b = await findBranch(req);
  branches(req);
  const used = Number(
    await scalar("SELECT EXISTS(SELECT 1 FROM users WHERE branch_id = ?) OR EXISTS(SELECT 1 FROM it_tickets WHERE branch_id = ?) OR EXISTS(SELECT 1 FROM assets WHERE branch_id = ? AND deleted_at IS NULL)", [b.id, b.id, b.id]),
  );
  if (used) throw ValidationError.withMessages({ branch: trans(req.locale, "eam.branch.in_use") });
  await update("branches", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [b.id]);
  res.status(204).end();
});

/* ================================================================ 5.2 ตั้งค่าการแจ้งเตือน (admin) */

/** ตั้งค่าทั้งหมด — secret_guard คืนค่าที่ใช้งานจริง (รวมค่าเริ่มต้น); PIN กลางส่งเฉพาะสถานะ (ห้ามส่ง hash) */
const settingsJson = async () => {
  const { secret_pin: _hidden, ...rest } = await allSettings();
  const guard = await secretGuard();
  return {
    ...rest,
    secret_guard: guard,
    // ค่าที่ใช้งานจริง (รวมค่าเริ่มต้น)
    password_policy: await passwordPolicy(),
    secret_pin_status: await centralPinStatus(),
    // ตัวเลือกผู้รับแจ้งเตือนเมื่อมีคนเปิดดูข้อมูลลับ (ผู้ใช้ที่ใช้งานอยู่) + ผู้รับจริงตอนนี้ (ไม่ได้เลือก = หัวหน้า IT)
    secret_notify_options: (await select<{ id: number; name: string; department: string | null }>("SELECT id, name, department FROM users WHERE is_active = true ORDER BY name LIMIT 2000")).map((x) => ({
      id: Number(x.id), name: x.department ? `${x.name} (${x.department})` : x.name,
    })),
    secret_notify_effective: await revealRecipients(guard),
  };
};

/* ================================================================ PIN กลางสำหรับเปิดดูข้อมูลลับ */

/** GET /secret-pin — สถานะ PIN กลาง (ตั้งแล้วหรือยัง / เมื่อไร / โดยใคร) */
itDataRoutes.get("/secret-pin", async (req, res) => {
  const u = me(req);
  authorize(can(u, "secrets.pin_manage") || can(u, "vault.view") || can(u, "assets.license_key"));
  res.json({ data: { ...(await centralPinStatus()), can_manage: can(u, "secrets.pin_manage") } });
});

/**
 * PUT /secret-pin { password, pin, pin_confirmation } — ตั้ง / เปลี่ยน PIN กลาง (สิทธิ์ secrets.pin_manage: admin หรือเจ้าหน้าที่ที่ได้รับสิทธิ์)
 * ต้องยืนยันด้วยรหัสผ่าน login ของผู้ตั้ง — เปลี่ยนแล้วปลดล็อก PIN ของทุกคน + audit (ไม่บันทึกค่า PIN)
 */
itDataRoutes.put("/secret-pin", limits.pinSet, async (req, res) => {
  const u = me(req);
  authorize(can(u, "secrets.pin_manage"));
  const t = (key: string) => trans(req.locale, `eam.secret_guard.${key}`);
  const data = await validate(
    req.input,
    {
      password: ["required", "string", "max:255"],
      pin: ["required", "string", custom((v) => typeof v === "string" && PIN_PATTERN.test(v), t("pin_format"))],
      pin_confirmation: ["required", "string"],
    },
    {
      locale: req.locale,
      after: ({ errors }) => {
        if (req.input.pin !== req.input.pin_confirmation) errors.add("pin_confirmation", t("pin_mismatch"));
      },
    },
  );
  if (!(await verifyLoginPassword(req, u, String(data.password)))) {
    await audit(req, { action: "settings.secret_pin_failed", subjectType: "settings", subjectId: "secret_pin" });
    throw ValidationError.withMessages({ password: t("wrong_password") });
  }
  const existed = (await centralPin()) !== null;
  await putSetting("secret_pin", { hash: makeHash(String(data.pin), config.bcryptRounds), set_at: pinSetAt(), set_by: { id: u.id, name: u.name } }, u.id);
  await exec("UPDATE users SET secret_pin_failures = 0, secret_pin_locked_until = NULL WHERE secret_pin_failures > 0 OR secret_pin_locked_until IS NOT NULL");
  await audit(req, { action: existed ? "settings.secret_pin_changed" : "settings.secret_pin_set", subjectType: "settings", subjectId: "secret_pin" });
  // PIN กลางเปลี่ยน = แจ้งผู้ดูแลระบบสูงสุด + ผู้ดูแลระบบทุกคน
  await notifyAccessChange(req, "pin", { id: "secret_pin", name: "" }, { first_time: !existed });
  res.json({ data: { ...(await centralPinStatus()), can_manage: true } });
});

/**
 * ตัวเลือกเรื่อง "อื่นๆ" ในใบแจ้งงาน = ข้อมูล Drop Down (หน้า /dropdowns แท็บ ticket_types) — สิทธิ์ dropdowns.manage
 * (แยกจาก PUT /settings ที่ต้องมี settings.manage เพื่อให้ผู้ดูแลข้อมูลหลักแก้ได้โดยไม่ต้องมีสิทธิ์ตั้งค่าระบบ)
 */
const otherTypes = (req: Request) => authorize(can(me(req), "dropdowns.manage") || can(me(req), "settings.manage"));
itDataRoutes.get("/ticket-other-types", async (req, res) => {
  otherTypes(req);
  res.json({ data: await getSetting("ticket_other_types") });
});
itDataRoutes.put("/ticket-other-types", async (req, res) => {
  otherTypes(req);
  const data = await validate(
    req.input,
    { items: ["nullable", "array", "max:30"], "items.*": ["required", "string", "max:100", "distinct"] },
    { locale: req.locale },
  );
  const before = await getSetting("ticket_other_types");
  const items = [...new Set(Object.values((data.items ?? {}) as Record<string, string>).map((x) => x.trim()))];
  await putSetting("ticket_other_types", items, me(req).id);
  await audit(req, { action: "settings.ticket_other_types_updated", subjectType: "settings", subjectId: "ticket_other_types", before: { items: before }, after: { items } });
  res.json({ data: items });
});

itDataRoutes.get("/settings", async (req, res) => {
  settings(req);
  res.json({ data: await settingsJson() });
});

/** กติกาตรวจค่าการมองเห็นเมนู/ปุ่ม + ลำดับเมนู + ชื่อเมนู (PUT /settings และ PUT /ui-config) */
const uiRules = (groupKeys: Set<string>, locale: Locale) => ({
  // สิทธิ์การมองเห็นเมนู/ปุ่ม: { "<key>": ["viewer", ...] } (กลุ่มที่ซ่อน)
  ui_permissions: ["sometimes", "array", "max:200"],
  "ui_permissions.*": ["array"],
  "ui_permissions.*.*": [custom((v) => typeof v === "string" && groupKeys.has(v), trans(locale, "eam.access.invalid_group"))],
  // ลำดับเมนู: { groups: [...], items: { "<groupId>": ["/href", ...] } }
  menu_order: ["sometimes", "array"],
  "menu_order.groups": ["sometimes", "array", "max:50"],
  "menu_order.groups.*": ["string", "max:50"],
  "menu_order.items": ["sometimes", "array", "max:50"],
  "menu_order.items.*": ["array", "max:100"],
  "menu_order.items.*.*": ["string", "max:100"],
  // ชื่อเมนูที่แก้เอง: { "<group id | /href>": { th, en } } — ต้องกรอกทั้งสองภาษา (กันชื่อสองภาษาไม่ตรงกัน)
  menu_labels: ["sometimes", "array", "max:100"],
  "menu_labels.*": ["array"],
  "menu_labels.*.th": ["required", "string", "max:60"],
  "menu_labels.*.en": ["required", "string", "max:60"],
});

// object ว่างเก็บเป็น [] เหมือน PHP (json_encode ของ array ว่าง)
const emptyToList = (v: unknown) => (v && typeof v === "object" && Object.keys(v).length === 0 ? [] : v);

/** ค่าที่ผ่าน uiRules → ค่าที่เก็บใน app_settings (เฉพาะคีย์ที่ส่งมา) */
function uiValues(data: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if ("ui_permissions" in data) values.ui_permissions = emptyToList(data.ui_permissions);
  if ("menu_order" in data) values.menu_order = emptyToList(data.menu_order);
  if ("menu_labels" in data) {
    const raw = (data.menu_labels ?? {}) as Record<string, { th: string; en: string }>;
    const clean: Record<string, { th: string; en: string }> = {};
    for (const [key, v] of Object.entries(raw)) {
      // key = id กลุ่มเมนู (a-z, -) หรือ path ของเมนู (/...)
      if (!/^(\/[a-z0-9\-/]{1,99}|[a-z][a-z0-9-]{0,49})$/.test(key)) continue;
      const th = String(v.th).trim();
      const en = String(v.en).trim();
      if (th && en) clean[key] = { th, en };
    }
    values.menu_labels = emptyToList(clean);
  }
  return values;
}

itDataRoutes.put("/settings", async (req, res) => {
  settings(req);
  // การมองเห็นเมนู/ปุ่ม และชื่อเมนู = ส่วนหนึ่งของหน้าสิทธิ์การใช้งาน (สงวนไว้ให้ผู้ดูแลระบบ)
  if ("ui_permissions" in req.input || "menu_labels" in req.input) authorize(can(me(req), "access.manage"));
  // บังคับ 2FA ผู้ดูแลระบบ = นโยบายความปลอดภัยของการเข้าสู่ระบบ (สงวนไว้ให้ผู้ดูแลระบบสูงสุด)
  if ("two_factor_required" in req.input) authorize(can(me(req), "access.manage"));
  // นโยบายรหัสผ่าน (ล็อกบัญชี / บังคับเปลี่ยนรหัสผ่าน) — services/password-policy.ts
  if ("password_policy" in req.input) authorize(can(me(req), "access.manage"));
  const groupKeys = new Set((await select<{ key: string }>('SELECT "key" FROM permission_groups')).map((g) => g.key));
  const data = await validate(
    req.input,
    {
      contract_notify_days: ["sometimes", "integer", "min:1", "max:365"],
      credential_notify_days: ["sometimes", "integer", "min:1", "max:365"],
      license_notify_days: ["sometimes", "integer", "min:1", "max:365"],
      notify_emails: ["sometimes", "array", "max:20"],
      "notify_emails.*": ["required", "email", "max:255", "distinct:ignore_case"],
      ticket_other_types: ["sometimes", "array", "max:30"],
      "ticket_other_types.*": ["required", "string", "max:100", "distinct"],
      ...uiRules(groupKeys, req.locale),
      // การป้องกันตอนเปิดดูรหัสผ่าน / License key (services/secret-guard.ts) — เปิด-ปิดแยกกัน
      secret_guard: ["sometimes", "array"],
      "secret_guard.reauth": ["sometimes", "boolean"],
      "secret_guard.reauth_method": ["sometimes", "in:password,pin"],
      // 0 = ยืนยันทุกครั้งที่เปิดดู
      "secret_guard.reauth_minutes": ["sometimes", "integer", "min:0", "max:60"],
      "secret_guard.ip_restrict": ["sometimes", "boolean"],
      "secret_guard.allowed_ips": ["sometimes", "array", "max:50"],
      "secret_guard.allowed_ips.*": ["string", "max:50", custom((v) => typeof v === "string" && isValidIpEntry(v), trans(req.locale, "eam.secret_guard.invalid_ip"))],
      "secret_guard.notify_heads": ["sometimes", "boolean"],
      // ผู้รับแจ้งเตือนเมื่อมีคนเปิดดู ([] = หัวหน้า IT ทุกคน)
      "secret_guard.notify_user_ids": ["sometimes", "array", "max:50"],
      "secret_guard.notify_user_ids.*": ["integer"],
      two_factor_required: ["sometimes", "boolean"],
      password_policy: ["sometimes", "array"],
      // 0 = ไม่ล็อกบัญชี
      "password_policy.lockout_attempts": ["sometimes", "integer", "min:0", "max:50"],
      "password_policy.lockout_minutes": ["sometimes", "integer", "min:1", "max:1440"],
      // 0 = ไม่บังคับเปลี่ยนรหัสผ่าน
      "password_policy.expiry_days": ["sometimes", "integer", "min:0", "max:730"],
      "password_policy.expiry_warn_days": ["sometimes", "integer", "min:0", "max:60"],
    },
    {
      locale: req.locale,
      after: async ({ errors }) => {
        const g = req.input.secret_guard as Record<string, unknown> | undefined;
        if (!g || typeof g !== "object") return;
        const current = await secretGuard();
        const restrict = "ip_restrict" in g ? bool(g.ip_restrict) : current.ip_restrict;
        const ips = Array.isArray(g.allowed_ips) ? g.allowed_ips : current.allowed_ips;
        // เปิดจำกัด IP แต่ไม่มี IP ในรายการ = ไม่มีใครเปิดดูได้เลย
        if (restrict && ips.length === 0) errors.add("secret_guard.allowed_ips", trans(req.locale, "eam.secret_guard.ip_required"));
        // ผู้รับแจ้งเตือนต้องเป็นผู้ใช้ที่ยังใช้งานอยู่
        if (Array.isArray(g.notify_user_ids) && g.notify_user_ids.length) {
          const ids = [...new Set(g.notify_user_ids.map(Number))];
          const found = ids.every((x) => Number.isInteger(x) && x > 0)
            ? Number(await scalar("SELECT COUNT(*) FROM users WHERE is_active = true AND id IN (?)", [ids]))
            : -1;
          if (found !== ids.length) errors.add("secret_guard.notify_user_ids", trans(req.locale, "eam.secret_guard.recipient_invalid"));
        }
      },
    },
  );

  const u = me(req);
  const values: Record<string, unknown> = {};
  if ("contract_notify_days" in data) values.contract_notify_days = int(data.contract_notify_days);
  if ("credential_notify_days" in data) values.credential_notify_days = int(data.credential_notify_days);
  if ("license_notify_days" in data) values.license_notify_days = int(data.license_notify_days);
  if ("ticket_other_types" in data) {
    values.ticket_other_types = [...new Set(Object.values(data.ticket_other_types as Record<string, string>).map((s) => s.trim()))];
  }
  if ("notify_emails" in data) {
    values.notify_emails = [...new Set(Object.values(data.notify_emails as Record<string, string>).map((s) => s.toLowerCase()))];
  }
  Object.assign(values, uiValues(data));
  if ("secret_guard" in data && data.secret_guard && typeof data.secret_guard === "object") {
    const g = data.secret_guard as Record<string, unknown>;
    const current = await secretGuard();
    values.secret_guard = {
      reauth: "reauth" in g ? bool(g.reauth) : current.reauth,
      reauth_method: "reauth_method" in g ? (g.reauth_method === "pin" ? "pin" : "password") : current.reauth_method,
      reauth_minutes: "reauth_minutes" in g ? int(g.reauth_minutes) : current.reauth_minutes,
      ip_restrict: "ip_restrict" in g ? bool(g.ip_restrict) : current.ip_restrict,
      allowed_ips: Array.isArray(g.allowed_ips) ? [...new Set((g.allowed_ips as string[]).map((s) => s.trim()))] : current.allowed_ips,
      notify_heads: "notify_heads" in g ? bool(g.notify_heads) : current.notify_heads,
      notify_user_ids: Array.isArray(g.notify_user_ids) ? [...new Set((g.notify_user_ids as unknown[]).map(Number))] : current.notify_user_ids,
    };
  }
  if ("two_factor_required" in data) values.two_factor_required = bool(data.two_factor_required);
  if ("password_policy" in data && data.password_policy && typeof data.password_policy === "object") {
    const p = data.password_policy as Record<string, unknown>;
    const current = await passwordPolicy();
    const next = {
      lockout_attempts: "lockout_attempts" in p ? int(p.lockout_attempts)! : current.lockout_attempts,
      lockout_minutes: "lockout_minutes" in p ? int(p.lockout_minutes)! : current.lockout_minutes,
      expiry_days: "expiry_days" in p ? int(p.expiry_days)! : current.expiry_days,
      expiry_warn_days: "expiry_warn_days" in p ? int(p.expiry_warn_days)! : current.expiry_warn_days,
      since: current.since,
    };
    // เพิ่งเปิดบังคับเปลี่ยน → ผู้ที่ยังไม่มีวันเปลี่ยนรหัสผ่านเริ่มนับจากวันนี้ (ไม่หมดอายุทันที) / ปิด = ล้างจุดเริ่มนับ
    if (next.expiry_days > 0 && (current.expiry_days <= 0 || !current.since)) next.since = nowDb();
    if (next.expiry_days <= 0) next.since = null;
    values.password_policy = next;
  }
  for (const [key, value] of Object.entries(values)) await putSetting(key, value, u.id);
  if ("two_factor_required" in values) await audit(req, { action: "settings.two_factor_required", subjectType: "settings", subjectId: "two_factor_required", after: { required: values.two_factor_required } });
  if ("menu_labels" in values) await audit(req, { action: "settings.menu_labels_updated", subjectType: "settings", subjectId: "menu_labels", after: { labels: values.menu_labels } });
  if ("password_policy" in values) await audit(req, { action: "settings.password_policy_updated", subjectType: "settings", subjectId: "password_policy", after: values.password_policy as Record<string, unknown> });
  if ("secret_guard" in values) await audit(req, { action: "settings.secret_guard_updated", subjectType: "settings", subjectId: "secret_guard", after: values.secret_guard as Record<string, unknown> });

  res.json({ data: await settingsJson() });
});

/** GET /ui-config — การมองเห็นเมนู/ปุ่ม + ลำดับเมนู (ทุกคนที่ login อ่านได้ ใช้สร้างเมนู) */
itDataRoutes.get("/ui-config", async (_req, res) => {
  const s = await allSettings();
  // role_permissions: สิทธิ์ของแต่ละกลุ่ม — หน้าตั้งค่าการมองเห็นใช้จำลองว่าแต่ละกลุ่มเข้าเมนูใดได้
  // logo_version: เปลี่ยนเมื่ออัปโหลดโลโก้ใหม่ (ใช้ต่อท้าย URL ให้ browser โหลดใหม่) — null = ไม่มีโลโก้
  res.json({
    data: { ui_permissions: s.ui_permissions, menu_order: s.menu_order, menu_labels: s.menu_labels, role_permissions: await audiencePermissions(), logo_version: s.logo_version ?? null },
  });
});

/**
 * PUT /ui-config { ui_permissions?, menu_order?, menu_labels? } — หน้า สิทธิ์การใช้งาน (/permissions)
 * access.manage = ทุกกลุ่ม · access.groups (admin) = ซ่อน/แสดงได้เฉพาะกลุ่มที่ต่ำกว่า (กลุ่มอื่นคงตามเดิม) + ลำดับ/ชื่อเมนู
 * เป็นการซ่อนเพิ่มจากสิทธิ์จริงเท่านั้น (สิทธิ์ตรวจที่ API เสมอ) — audit ทุกครั้ง
 */
itDataRoutes.put("/ui-config", async (req, res) => {
  const u = me(req);
  authorize(can(u, "access.manage") || can(u, "access.groups"));
  const groupKeys = new Set((await select<{ key: string }>('SELECT "key" FROM permission_groups')).map((g) => g.key));
  const data = await validate(req.input, uiRules(groupKeys, req.locale), { locale: req.locale });
  const values = uiValues(data);
  const s = await allSettings();
  const asMap = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string[]>) : {});
  if ("ui_permissions" in values) {
    values.ui_permissions = emptyToList(keepLockedHidden(await editableGroupKeys(u, req.locale), asMap(s.ui_permissions), asMap(values.ui_permissions)));
  }
  for (const [key, value] of Object.entries(values)) await putSetting(key, value, u.id);
  const changed = Object.keys(values).filter((k) => JSON.stringify(s[k] ?? []) !== JSON.stringify(values[k]));
  if (changed.length) {
    await audit(req, {
      action: "settings.ui_config_updated",
      subjectType: "settings",
      subjectId: "ui_config",
      before: Object.fromEntries(changed.map((k) => [k, s[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, values[k]])),
    });
  }
  const fresh = await allSettings();
  res.json({ data: { ui_permissions: fresh.ui_permissions, menu_order: fresh.menu_order, menu_labels: fresh.menu_labels } });
});

/* ================================================================ แจ้งเตือนในระบบ (กระดิ่ง) */

const USER_TYPE = "App\\Models\\User";

itDataRoutes.get("/notifications", async (req, res) => {
  const f = await validate(
    req.input,
    { unread: ["nullable", "boolean"], per_page: ["nullable", "integer", "min:1", "max:50"] },
    { locale: req.locale },
  );
  const u = me(req);
  const perPage = int(f.per_page) ?? 15;
  const page = pageParam(req);
  const unreadOnly = bool(req.query.unread);
  const where = `notifiable_type = ? AND notifiable_id = ?${unreadOnly ? " AND read_at IS NULL" : ""}`;

  const total = Number(await scalar(`SELECT COUNT(*) FROM notifications WHERE ${where}`, [USER_TYPE, u.id]));
  const rows = await select<{ id: string; data: string; read_at: string | null; created_at: string }>(
    `SELECT id, data, read_at, created_at FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [USER_TYPE, u.id, perPage, (page - 1) * perPage],
  );
  const unread = Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_type = ? AND notifiable_id = ? AND read_at IS NULL", [USER_TYPE, u.id]));

  res.json({
    data: rows.map((n) => ({ id: n.id, data: JSON.parse(n.data), read_at: iso(n.read_at), created_at: iso(n.created_at) })),
    unread_count: unread,
    meta: { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total },
  });
});

itDataRoutes.post("/notifications/read-all", async (req, res) => {
  await update("notifications", { read_at: nowDb() }, "notifiable_type = ? AND notifiable_id = ? AND read_at IS NULL", [USER_TYPE, me(req).id]);
  res.status(204).end();
});

/** DELETE /notifications?only=read — ล้างแจ้งเตือนของตัวเอง (ไม่ระบุ = ทั้งหมด, read = เฉพาะที่อ่านแล้ว) */
itDataRoutes.delete("/notifications", async (req, res) => {
  const f = await validate(req.input, { only: ["nullable", "in:read"] }, { locale: req.locale });
  await exec(
    `DELETE FROM notifications WHERE notifiable_type = ? AND notifiable_id = ?${f.only === "read" ? " AND read_at IS NOT NULL" : ""}`,
    [USER_TYPE, me(req).id],
  );
  res.status(204).end();
});

/** DELETE /notifications/{id} — ลบแจ้งเตือนรายการเดียว (ของตัวเองเท่านั้น — ของคนอื่น/ไม่พบ = ไม่มีอะไรเปลี่ยน) */
itDataRoutes.delete("/notifications/:id", async (req, res) => {
  if (isUuid(req.params.id)) {
    await exec("DELETE FROM notifications WHERE id = ? AND notifiable_type = ? AND notifiable_id = ?", [req.params.id, USER_TYPE, me(req).id]);
  }
  res.status(204).end();
});

itDataRoutes.post("/notifications/:id/read", async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(204).end(); // ไม่พบ = ไม่มีอะไรให้อัปเดต (เหมือน Laravel)
  await update("notifications", { read_at: nowDb() }, "id = ? AND notifiable_type = ? AND notifiable_id = ?", [req.params.id, USER_TYPE, me(req).id]);
  res.status(204).end();
});

/* ================================================================ 4.1.1 คลังบัญชี/รหัสผ่าน */

/** หมวดหมู่ตั้งต้น (แปลชื่อที่หน้าเว็บ) — เพิ่มหมวดใหม่เองได้จากฟอร์ม (เก็บเป็นชื่อที่พิมพ์ ไม่เกิน 30 ตัว) */
const CATEGORIES: string[] = [...BUILTIN_CATEGORIES];
const categoryRule = (req: Request) =>
  custom((v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 30, trans(req.locale, "eam.vault.invalid_category"));

interface CredentialRow {
  id: number; title: string; category: string; url: string | null; username: string | null;
  password: string | null; secret_notes: string | null; notes: string | null;
  branch_id: number | null; owner_id: number | null; expires_at: string | null;
  password_changed_at: string | null; updated_at: string | null; require_reauth: boolean;
  access_mode: string; created_by: number | null;
  b_id?: number | null; b_name?: string | null; o_id?: number | null; o_name?: string | null; upd_name?: string | null;
}

const CREDENTIAL_SELECT = `c.*, b.id AS b_id, b.name AS b_name, o.id AS o_id, o.name AS o_name, upd.name AS upd_name
  FROM credentials c
  LEFT JOIN branches b ON b.id = c.branch_id AND b.deleted_at IS NULL
  LEFT JOIN users o ON o.id = c.owner_id
  LEFT JOIN users upd ON upd.id = c.updated_by`;

/** list/show ไม่ส่งรหัสผ่านกลับ (มีแค่ has_password) */
const credentialJson = (c: CredentialRow) => ({
  id: c.id,
  title: c.title,
  category: c.category,
  url: c.url,
  username: c.username,
  has_password: c.password !== null,
  has_secret_notes: c.secret_notes !== null,
  /** ต้องยืนยันตัวตนก่อนเปิดดู (ใช้เมื่อเปิดการยืนยันในหน้าตั้งค่าระบบ) */
  require_reauth: Boolean(c.require_reauth),
  /** all = ทุกคนที่มีสิทธิ์คลังบัญชี / restricted = เฉพาะผู้ใช้-กลุ่มที่เลือก + เจ้าของ + ผู้สร้าง */
  access_mode: c.access_mode === "restricted" ? "restricted" : "all",
  notes: c.notes,
  branch: c.b_id ? { id: c.b_id, name: c.b_name } : null,
  branch_id: c.branch_id,
  owner: c.o_id ? { id: c.o_id, name: c.o_name } : null,
  expires_at: dateOnly(c.expires_at),
  password_changed_at: iso(c.password_changed_at),
  updated_by: c.upd_name ?? null,
  updated_at: iso(c.updated_at),
});

/**
 * สิทธิ์รายรายการ: access_mode = all → ทุกคนที่มีสิทธิ์คลังบัญชี (ค่าเดิม)
 * restricted → ผู้ใช้ / กลุ่มสิทธิ์ใน credential_access + เจ้าของ (owner_id) + ผู้สร้าง + ผู้มี vault.all (ผู้ดูแลระบบสูงสุดผ่านเสมอ)
 * ผู้ที่ไม่มีสิทธิ์ไม่เห็นรายการนั้นเลย (รายการ / ดู / แก้ / ลบ / เปิดดู / ประวัติ = 404)
 */
async function accessWhere(u: UserRow): Promise<{ sql: string; params: unknown[] }> {
  if (can(u, "vault.all")) return { sql: "1 = 1", params: [] };
  const groups = await groupsOf(u);
  return {
    sql: `(c.access_mode <> 'restricted' OR c.owner_id = ? OR c.created_by = ?
      OR EXISTS (SELECT 1 FROM credential_access a WHERE a.credential_id = c.id AND (a.user_id = ? OR a.group_key IN (?))))`,
    params: [u.id, u.id, u.id, groups],
  };
}

async function loadCredential(id: number, u: UserRow): Promise<CredentialRow> {
  const w = await accessWhere(u);
  const c = await first<CredentialRow>(`SELECT ${CREDENTIAL_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL AND ${w.sql}`, [id, ...w.params]);
  if (!c) throw notFound();
  return c;
}

interface AccessInfo { mode: "all" | "restricted"; users: { id: number; name: string }[]; groups: string[] }

async function accessOf(c: Pick<CredentialRow, "id" | "access_mode">): Promise<AccessInfo> {
  const rows = await select<{ user_id: number | null; group_key: string | null; name: string | null }>(
    "SELECT a.user_id, a.group_key, u.name FROM credential_access a LEFT JOIN users u ON u.id = a.user_id WHERE a.credential_id = ? ORDER BY u.name, a.group_key",
    [c.id],
  );
  return {
    mode: c.access_mode === "restricted" ? "restricted" : "all",
    users: rows.filter((r) => r.user_id !== null).map((r) => ({ id: Number(r.user_id), name: r.name ?? "" })),
    groups: rows.filter((r) => r.group_key !== null).map((r) => r.group_key!),
  };
}

/** รายละเอียด + การเข้าถึง (ผู้ใช้ / กลุ่มที่เลือก) */
const credentialDetail = async (c: CredentialRow) => {
  const a = await accessOf(c);
  return { ...credentialJson(c), access_users: a.users, access_groups: a.groups };
};

/** ตรวจ + เตรียมค่าการเข้าถึงจาก input (ไม่ส่ง access_mode มา = ไม่แตะ) */
async function accessInput(req: Request, current: CredentialRow | null): Promise<AccessInfo | null> {
  const raw = req.input;
  if (raw.access_mode === undefined && raw.access_user_ids === undefined && raw.access_groups === undefined) return null;
  const data = await validate(
    raw,
    {
      access_mode: ["required", "in:all,restricted"],
      access_user_ids: ["nullable", "array", "max:100"],
      "access_user_ids.*": ["integer"],
      access_groups: ["nullable", "array", "max:50"],
      "access_groups.*": ["string", "max:50"],
    },
    { locale: req.locale },
  );
  const mode = data.access_mode === "restricted" ? "restricted" : "all";
  const ids = [...new Set(Object.values((data.access_user_ids as Record<string, unknown>) ?? {}).map(Number))];
  const groups = [...new Set(Object.values((data.access_groups as Record<string, unknown>) ?? {}).map((g) => String(g).trim()))];
  const t = (key: string) => trans(req.locale, `eam.vault.${key}`);
  if (ids.length) {
    const found = await select<{ id: number; name: string }>("SELECT id, name FROM users WHERE is_active = true AND id IN (?)", [ids]);
    if (found.length !== ids.length) throw ValidationError.withMessages({ access_user_ids: t("access_user_invalid") });
  }
  if (groups.length) {
    const found = await select<{ key: string }>('SELECT "key" FROM permission_groups WHERE "key" IN (?)', [groups]);
    if (found.length !== groups.length) throw ValidationError.withMessages({ access_groups: t("access_group_invalid") });
  }
  // จำกัดสิทธิ์แล้วตัวผู้แก้ต้องยังเข้าถึงได้ (กันล็อกตัวเองออก)
  if (mode === "restricted") {
    const u = me(req);
    const owner = "owner_id" in raw ? int(raw.owner_id) : (current?.owner_id ?? null);
    const creator = current ? current.created_by : u.id;
    const keeps =
      can(u, "vault.all") || owner === u.id || creator === u.id || ids.includes(u.id) || (await groupsOf(u)).some((g) => groups.includes(g));
    if (!keeps) throw ValidationError.withMessages({ access_mode: t("access_self") });
  }
  const names = ids.length ? await select<{ id: number; name: string }>("SELECT id, name FROM users WHERE id IN (?) ORDER BY name", [ids]) : [];
  return { mode, users: names.map((n) => ({ id: Number(n.id), name: n.name })), groups: mode === "restricted" ? groups : [] };
}

/** บันทึกการเข้าถึง (แทนที่ทั้งชุด) + audit ถ้าเปลี่ยน */
async function saveAccess(req: Request, credentialId: number, before: AccessInfo | null, next: AccessInfo) {
  const users = next.mode === "restricted" ? next.users : [];
  await update("credentials", { access_mode: next.mode }, "id = ?", [credentialId]);
  await exec("DELETE FROM credential_access WHERE credential_id = ?", [credentialId]);
  const now = nowDb();
  for (const x of users) await insert("credential_access", { credential_id: credentialId, user_id: x.id, created_by: me(req).id, created_at: now });
  for (const g of next.groups) await insert("credential_access", { credential_id: credentialId, group_key: g, created_by: me(req).id, created_at: now });
  const view = (a: AccessInfo | null) => (a ? { mode: a.mode, user_ids: a.users.map((x) => x.id).sort(), groups: [...a.groups].sort() } : null);
  const after = view({ ...next, users });
  if (JSON.stringify(view(before)) !== JSON.stringify(after)) {
    await audit(req, { action: "credential.access_updated", subjectType: "credential", subjectId: credentialId, before: view(before), after });
  }
}

/**
 * currentReauth = ค่าเดิมของรายการ (แก้ไข) — ปิด "ต้องยืนยันตัวตนก่อนเปิดดู" ได้เฉพาะผู้มีสิทธิ์ vault.all (ผู้ดูแลระบบสูงสุด)
 * เปิดกลับได้ทุกคนที่แก้รายการได้ และส่งค่าเดิม (ปิดอยู่แล้ว) มาพร้อมการแก้ช่องอื่นได้
 */
async function credentialInput(req: Request, partial: boolean, currentReauth?: boolean) {
  const s = partial ? ["sometimes"] : [];
  const data = await validate(
    req.input,
    {
      title: [...s, "required", "string", "max:255"],
      category: [...s, "required", "string", categoryRule(req)],
      url: ["sometimes", "nullable", "string", "max:500"],
      username: ["sometimes", "nullable", "string", "max:255"],
      password: ["sometimes", "nullable", "string", "max:1000"],
      secret_notes: ["sometimes", "nullable", "string", "max:5000"],
      notes: ["sometimes", "nullable", "string", "max:5000"],
      branch_id: ["sometimes", "nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      owner_id: ["sometimes", "nullable", "integer", exists("users", "id")],
      expires_at: ["sometimes", "nullable", "date"],
      require_reauth: ["sometimes", "boolean"],
    },
    { locale: req.locale },
  );
  const out: Record<string, unknown> = {};
  if ("require_reauth" in data) {
    out.require_reauth = bool(data.require_reauth);
    if (!out.require_reauth && currentReauth !== false && !can(me(req), "vault.all")) {
      throw ValidationError.withMessages({ require_reauth: trans(req.locale, "eam.vault.reauth_locked") });
    }
  }
  for (const key of ["title", "url", "username", "notes"]) if (key in data) out[key] = data[key];
  if ("category" in data) out.category = String(data.category).trim();
  for (const key of ["branch_id", "owner_id"]) if (key in data) out[key] = int(data[key]);
  if ("expires_at" in data) out.expires_at = data.expires_at === null ? null : String(data.expires_at).slice(0, 10);
  // password/secret_notes: ไม่ส่งมา = คงเดิม, ส่ง null ("") = ลบ — เข้ารหัสด้วยกุญแจคลัง (VAULT_KEY, ไม่ตั้ง = APP_KEY)
  if ("password" in data) out.password = encryptVaultNullable(data.password as string | null);
  if ("secret_notes" in data) out.secret_notes = encryptVaultNullable(data.secret_notes as string | null);
  return { out, plainPassword: data.password as string | null | undefined };
}

async function logAccess(req: Request, credentialId: number, action: string) {
  await insert("credential_access_logs", { credential_id: credentialId, user_id: me(req).id, action, ip: req.ip ?? null, created_at: nowDb() });
}

itDataRoutes.get("/credentials", async (req, res) => {
  vault(req, "view");
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      category: ["nullable", "string", "max:30"],
      branch_id: ["nullable", "integer"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  // เฉพาะรายการที่ผู้ใช้เข้าถึงได้ (สิทธิ์รายรายการ)
  const access = await accessWhere(me(req));
  const where = ["c.deleted_at IS NULL", access.sql];
  const params: unknown[] = [...access.params];
  const term = String(f.search ?? "").trim();
  if (term) {
    const t = `%${likeEscape(term)}%`;
    where.push("(c.title LIKE ? OR c.username LIKE ? OR c.url LIKE ?)");
    params.push(t, t, t);
  }
  if (f.category) (where.push("c.category = ?"), params.push(f.category));
  if (f.branch_id) (where.push("c.branch_id = ?"), params.push(int(f.branch_id)));
  const whereSql = where.join(" AND ");

  const total = Number(await scalar(`SELECT COUNT(*) FROM credentials c WHERE ${whereSql}`, params));
  const rows = await select<CredentialRow>(`SELECT ${CREDENTIAL_SELECT} WHERE ${whereSql} ORDER BY c.title LIMIT ? OFFSET ?`, [
    ...params, perPage, (page - 1) * perPage,
  ]);
  res.json({ data: rows.map(credentialJson), meta: shortMeta(total, page, perPage, rows.length) });
});

/** GET /credentials/categories — หมวดตั้งต้น + หมวดที่ผู้ใช้เพิ่มเอง (ที่ยังมีบัญชีใช้อยู่) */
itDataRoutes.get("/credentials/categories", async (req, res) => {
  vault(req, "view", "create", "update");
  const custom = await select<{ category: string }>(
    "SELECT DISTINCT category FROM credentials WHERE deleted_at IS NULL AND category NOT IN (?) ORDER BY category",
    [CATEGORIES],
  );
  res.json({ data: { builtin: CATEGORIES, custom: custom.map((c) => c.category) } });
});

/** ตัวเลือกการเข้าถึงรายรายการ: ผู้ใช้ที่มีสิทธิ์ดูคลังบัญชี + กลุ่มสิทธิ์ทั้งหมด */
itDataRoutes.get("/credentials/access-options", async (req, res) => {
  vault(req, "create", "update");
  const users = await usersWithPermissions(["vault.view"]);
  const groups = await select<{ key: string; name_th: string; name_en: string }>('SELECT "key", name_th, name_en FROM permission_groups ORDER BY sort_order, "key"');
  res.json({ data: { users: users.map((u) => ({ id: Number(u.id), name: u.name })), groups: groups.map((g) => ({ key: g.key, name_th: g.name_th, name_en: g.name_en })) } });
});

itDataRoutes.get("/credentials/:id", async (req, res) => {
  vault(req, "view", "update");
  const c = await loadCredential(routeId(req), me(req));
  res.json({ data: await credentialDetail(c) });
});

itDataRoutes.post("/credentials", async (req, res) => {
  vault(req, "create");
  const { out, plainPassword } = await credentialInput(req, false);
  const access = await accessInput(req, null);
  const u = me(req);
  const id = await transaction(async () => {
    const now = nowDb();
    const newId = await insert("credentials", {
      category: "system",
      ...out,
      created_by: u.id,
      updated_by: u.id,
      password_changed_at: plainPassword ? now : null,
      created_at: now,
      updated_at: now,
    });
    await logAccess(req, newId, "create");
    if (access) await saveAccess(req, newId, null, access);
    return newId;
  });
  // Laravel ตอบหลัง refresh() (ไม่โหลด relation) → branch/owner/updated_by เป็น null
  const c = await loadCredential(id, u);
  res.status(201).json({ data: { ...(await credentialDetail(c)), branch: null, owner: null, updated_by: null } });
});

async function updateCredential(req: Request, res: import("express").Response) {
  vault(req, "update");
  const current = await loadCredential(routeId(req), me(req));
  const { out, plainPassword } = await credentialInput(req, true, Boolean(current.require_reauth));
  const access = await accessInput(req, current);
  const accessBefore = access ? await accessOf(current) : null;
  await transaction(async () => {
    const changes: Record<string, unknown> = { ...out, updated_by: me(req).id, updated_at: nowDb() };
    // password_changed_at เมื่อรหัสผ่านเปลี่ยนจริง (isDirty)
    if ("password" in out) {
      const before = decryptVaultNullable(current.password);
      if ((plainPassword ?? null) !== before) changes.password_changed_at = nowDb();
      else delete changes.password; // ไม่เปลี่ยน → ไม่เขียน ciphertext ใหม่
    }
    await update("credentials", changes, "id = ?", [current.id]);
    await logAccess(req, current.id, "update");
    if (access) await saveAccess(req, current.id, accessBefore, access);
  });
  res.json({ data: await credentialDetail(await loadCredential(current.id, me(req))) });
}
itDataRoutes.put("/credentials/:id", updateCredential);
itDataRoutes.patch("/credentials/:id", updateCredential);

itDataRoutes.delete("/credentials/:id", async (req, res) => {
  vault(req, "delete");
  const c = await loadCredential(routeId(req), me(req));
  await logAccess(req, c.id, "delete");
  await update("credentials", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [c.id]);
  res.status(204).end();
});

/** เปิดดูรหัสผ่าน — ตรวจ IP / ยืนยันรหัสผ่านซ้ำ (ถ้าเปิดใช้) แล้วบันทึก log ผู้เปิดดู + IP ทุกครั้ง + แจ้งหัวหน้า IT (ถ้าเปิดใช้) */
itDataRoutes.post("/credentials/:id/reveal", limits.reveal, async (req, res) => {
  vault(req, "view");
  const c = await loadCredential(routeId(req), me(req));
  // บัญชีที่ปิด "ต้องยืนยันก่อนเปิดดู" → ข้ามการยืนยันตัวตน (ยังตรวจ IP + บันทึก log + แจ้งเตือนตามปกติ)
  await assertCanReveal(req, { reauth: Boolean(c.require_reauth) });
  await logAccess(req, c.id, "reveal");
  await notifyReveal(req, "vault", { id: c.id, title: c.title });
  res.json({ data: { password: decryptVaultNullable(c.password), secret_notes: decryptVaultNullable(c.secret_notes) } });
});

/** ประวัติการเข้าถึง (ล่าสุด 50 รายการ) */
itDataRoutes.get("/credentials/:id/logs", async (req, res) => {
  vault(req, "view");
  const c = await loadCredential(routeId(req), me(req));
  const logs = await select<{ id: number; action: string; ip: string | null; created_at: string; u_id: number | null; u_name: string | null }>(
    `SELECT l.id, l.action, l.ip, l.created_at, u.id AS u_id, u.name AS u_name
       FROM credential_access_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.credential_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 50`,
    [c.id],
  );
  res.json({
    data: logs.map((l) => ({
      id: l.id,
      action: l.action,
      user: l.u_id ? { id: l.u_id, name: l.u_name } : null,
      ip: l.ip,
      created_at: iso(l.created_at),
    })),
  });
});

/* ================================================================ 4.1.2 สัญญา vendor */

interface ContractRow {
  id: number; title: string; vendor_name: string; contract_no: string | null; start_date: string; end_date: string;
  amount: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  notify_days_before: number | null; notify_enabled: number; notified_at: string | null; notes: string | null;
  branch_id: number | null; b_id?: number | null; b_name?: string | null;
  category_id?: number | null; cat_name?: string | null; cat_key?: string | null;
}

/** จำนวนวันที่เหลือ / สถานะ — เหมือน Contract::daysLeft() / status() */
export function contractStatus(c: Pick<ContractRow, "end_date" | "notify_days_before">, defaultDays: number, today = new Date()) {
  const daysLeft = diffInDays(today, fromDbDate(c.end_date));
  const notifyDays = c.notify_days_before ?? defaultDays;
  const status = daysLeft < 0 ? "expired" : daysLeft <= notifyDays ? "expiring" : "active";
  return { daysLeft, notifyDays, status } as const;
}

function contractJson(c: ContractRow, defaultDays: number, withBranch: boolean) {
  const s = contractStatus(c, defaultDays);
  return {
    id: c.id,
    title: c.title,
    vendor_name: c.vendor_name,
    contract_no: c.contract_no,
    start_date: dateOnly(c.start_date),
    end_date: dateOnly(c.end_date),
    amount: c.amount,
    contact_name: c.contact_name,
    contact_email: c.contact_email,
    contact_phone: c.contact_phone,
    notify_days_before: c.notify_days_before,
    effective_notify_days: s.notifyDays,
    notify_enabled: Boolean(Number(c.notify_enabled)),
    notified_at: iso(c.notified_at),
    notes: c.notes,
    branch: withBranch && c.b_id ? { id: c.b_id, name: c.b_name } : null,
    branch_id: c.branch_id,
    category: c.category_id ? { id: Number(c.category_id), name: c.cat_name ?? "", key: c.cat_key ?? null } : null,
    days_left: s.daysLeft,
    status: s.status,
  };
}

const CONTRACT_SELECT =
  "c.*, b.id AS b_id, b.name AS b_name, cc.name AS cat_name, cc.builtin_key AS cat_key FROM contracts c LEFT JOIN branches b ON b.id = c.branch_id AND b.deleted_at IS NULL LEFT JOIN contract_categories cc ON cc.id = c.category_id";

async function loadContract(id: number): Promise<ContractRow> {
  const c = await first<ContractRow>(`SELECT ${CONTRACT_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`, [id]);
  if (!c) throw notFound();
  return c;
}

async function contractInput(req: Request, partial: boolean) {
  const s = partial ? ["sometimes"] : [];
  const data = await validate(
    req.input,
    {
      title: [...s, "required", "string", "max:255"],
      vendor_name: [...s, "required", "string", "max:255"],
      contract_no: ["sometimes", "nullable", "string", "max:100"],
      start_date: [...s, "required", "date"],
      end_date: [...s, "required", "date", "after_or_equal:start_date"],
      amount: ["sometimes", "nullable", "numeric", "min:0", "max:9999999999999.99"],
      contact_name: ["sometimes", "nullable", "string", "max:255"],
      contact_email: ["sometimes", "nullable", "email", "max:255"],
      contact_phone: ["sometimes", "nullable", "string", "max:50"],
      notify_days_before: ["sometimes", "nullable", "integer", "min:1", "max:365"],
      notify_enabled: ["sometimes", "boolean"],
      notes: ["sometimes", "nullable", "string", "max:5000"],
      branch_id: ["sometimes", "nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      category_id: ["sometimes", "nullable", "integer", exists("contract_categories", "id")],
    },
    { locale: req.locale },
  );
  const out: Record<string, unknown> = {};
  for (const key of ["title", "vendor_name", "contract_no", "contact_name", "contact_email", "contact_phone", "notes"]) if (key in data) out[key] = data[key];
  for (const key of ["start_date", "end_date"]) if (key in data) out[key] = String(data[key]).slice(0, 10);
  if ("amount" in data) out.amount = data.amount === null ? null : Number(data.amount).toFixed(2);
  if ("notify_days_before" in data) out.notify_days_before = int(data.notify_days_before);
  if ("notify_enabled" in data) out.notify_enabled = bool(data.notify_enabled);
  if ("branch_id" in data) out.branch_id = int(data.branch_id);
  if ("category_id" in data) out.category_id = int(data.category_id);
  return out;
}

/** GET /contracts?status=active|expiring|expired&search=&branch_id=&category_id= (+ summary, default_notify_days) */
itDataRoutes.get("/contracts", async (req, res) => {
  contracts(req, "view");
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      status: ["nullable", "in:active,expiring,expired"],
      branch_id: ["nullable", "integer"],
      category_id: ["nullable", "integer"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const defaultDays = Number(await getSetting("contract_notify_days"));
  const term = likeEscape(String(f.search ?? "").trim());
  const where = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (term) {
    where.push("(c.title LIKE ? OR c.vendor_name LIKE ? OR c.contract_no LIKE ?)");
    params.push(`%${term}%`, `%${term}%`, `${term}%`);
  }
  // ตัวกรองสาขา / หมวดหมู่
  if (f.branch_id) {
    where.push("c.branch_id = ?");
    params.push(int(f.branch_id));
  }
  if (f.category_id) {
    where.push("c.category_id = ?");
    params.push(int(f.category_id));
  }
  const rows = await select<ContractRow>(`SELECT ${CONTRACT_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.end_date`, params);
  // สถานะขึ้นกับจำนวนวันแจ้งเตือนของแต่ละสัญญา จึงกรองหลังคำนวณ
  const list = rows.map((c) => contractJson(c, defaultDays, true)).filter((c) => !f.status || c.status === f.status);

  const summary = { active: 0, expiring: 0, expired: 0 };
  for (const c of await select<ContractRow>("SELECT end_date, notify_days_before FROM contracts WHERE deleted_at IS NULL")) {
    summary[contractStatus(c, defaultDays).status]++;
  }
  res.json({ data: list, summary, default_notify_days: defaultDays });
});

itDataRoutes.get("/contracts/:id", async (req, res) => {
  const c = await loadContract(routeId(req));
  contracts(req, "view", "update");
  res.json({ data: contractJson(c, Number(await getSetting("contract_notify_days")), true) });
});

itDataRoutes.post("/contracts", async (req, res) => {
  contracts(req, "create");
  const out = await contractInput(req, false);
  const now = nowDb();
  const id = await insert("contracts", { notify_enabled: true, ...out, created_by: me(req).id, created_at: now, updated_at: now });
  res.status(201).json({ data: contractJson(await loadContract(id), Number(await getSetting("contract_notify_days")), true) });
});

async function updateContract(req: Request, res: import("express").Response) {
  const current = await loadContract(routeId(req));
  contracts(req, "update");
  const out = await contractInput(req, true);
  await update("contracts", { ...out, updated_at: nowDb() }, "id = ?", [current.id]);
  res.json({ data: contractJson(await loadContract(current.id), Number(await getSetting("contract_notify_days")), true) });
}
itDataRoutes.put("/contracts/:id", updateContract);
itDataRoutes.patch("/contracts/:id", updateContract);

itDataRoutes.delete("/contracts/:id", async (req, res) => {
  const c = await loadContract(routeId(req));
  contracts(req, "delete");
  await update("contracts", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [c.id]);
  res.status(204).end();
});
