import { Router, type Request } from "express";
import { exec, first, insert, isUuid, likeEscape, scalar, select, transaction, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { decryptNullable, encryptNullable } from "../lib/laravel-crypt.js";
import { limits } from "../lib/rate-limit.js";
import { dateOnly, diffInDays, fromDbDate, iso, nowDb } from "../lib/time.js";
import { bool, exists, int, regex, unique, validate } from "../lib/validator.js";
import { me, shortMeta, pageParam } from "../http.js";
import { can } from "../models/user.js";
import { audiencePermissions } from "../services/permissions.js";
import { allSettings, getSetting, putSetting } from "../services/settings.js";

/** IT-SYSTEM: สาขา, ตั้งค่า, แจ้งเตือนในระบบ, คลังบัญชี/รหัสผ่าน, สัญญา vendor */
export const itDataRoutes = Router();

/** กลุ่มผู้ใช้ในหน้าสิทธิ์การใช้งาน (frontend: lib/permissions.ts) */
const UI_AUDIENCES = ["admin", "manager", "viewer", "it_staff", "it_head"];

const routeId = (req: Request) => (/^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN);
const vault = (req: Request) => authorize(can(me(req), "vault.use"));
const contracts = (req: Request) => authorize(can(me(req), "contracts.manage"));
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

itDataRoutes.get("/settings", async (req, res) => {
  settings(req);
  res.json({ data: await allSettings() });
});

itDataRoutes.put("/settings", async (req, res) => {
  settings(req);
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
      // สิทธิ์การมองเห็นเมนู/ปุ่ม: { "<key>": ["viewer", ...] }
      ui_permissions: ["sometimes", "array", "max:200"],
      "ui_permissions.*": ["array"],
      "ui_permissions.*.*": [`in:${UI_AUDIENCES.join(",")}`],
      // ลำดับเมนู: { groups: [...], items: { "<groupId>": ["/href", ...] } }
      menu_order: ["sometimes", "array"],
      "menu_order.groups": ["sometimes", "array", "max:50"],
      "menu_order.groups.*": ["string", "max:50"],
      "menu_order.items": ["sometimes", "array", "max:50"],
      "menu_order.items.*": ["array", "max:100"],
      "menu_order.items.*.*": ["string", "max:100"],
    },
    { locale: req.locale },
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
  // object ว่างเก็บเป็น [] เหมือน PHP (json_encode ของ array ว่าง)
  const emptyToList = (v: unknown) => (v && typeof v === "object" && Object.keys(v).length === 0 ? [] : v);
  if ("ui_permissions" in data) values.ui_permissions = emptyToList(data.ui_permissions);
  if ("menu_order" in data) values.menu_order = emptyToList(data.menu_order);
  for (const [key, value] of Object.entries(values)) await putSetting(key, value, u.id);

  res.json({ data: await allSettings() });
});

/** GET /ui-config — การมองเห็นเมนู/ปุ่ม + ลำดับเมนู (ทุกคนที่ login อ่านได้ ใช้สร้างเมนู) */
itDataRoutes.get("/ui-config", async (_req, res) => {
  const s = await allSettings();
  // role_permissions: สิทธิ์ของแต่ละกลุ่ม — หน้าตั้งค่าการมองเห็นใช้จำลองว่าแต่ละกลุ่มเข้าเมนูใดได้
  // logo_version: เปลี่ยนเมื่ออัปโหลดโลโก้ใหม่ (ใช้ต่อท้าย URL ให้ browser โหลดใหม่) — null = ไม่มีโลโก้
  res.json({
    data: { ui_permissions: s.ui_permissions, menu_order: s.menu_order, role_permissions: await audiencePermissions(), logo_version: s.logo_version ?? null },
  });
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

const CATEGORIES = ["system", "server", "network", "email", "software", "cloud", "other"];

interface CredentialRow {
  id: number; title: string; category: string; url: string | null; username: string | null;
  password: string | null; secret_notes: string | null; notes: string | null;
  branch_id: number | null; owner_id: number | null; expires_at: string | null;
  password_changed_at: string | null; updated_at: string | null;
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
  notes: c.notes,
  branch: c.b_id ? { id: c.b_id, name: c.b_name } : null,
  branch_id: c.branch_id,
  owner: c.o_id ? { id: c.o_id, name: c.o_name } : null,
  expires_at: dateOnly(c.expires_at),
  password_changed_at: iso(c.password_changed_at),
  updated_by: c.upd_name ?? null,
  updated_at: iso(c.updated_at),
});

async function loadCredential(id: number): Promise<CredentialRow> {
  const c = await first<CredentialRow>(`SELECT ${CREDENTIAL_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`, [id]);
  if (!c) throw notFound();
  return c;
}

async function credentialInput(req: Request, partial: boolean) {
  const s = partial ? ["sometimes"] : [];
  const data = await validate(
    req.input,
    {
      title: [...s, "required", "string", "max:255"],
      category: [...s, "required", `in:${CATEGORIES.join(",")}`],
      url: ["sometimes", "nullable", "string", "max:500"],
      username: ["sometimes", "nullable", "string", "max:255"],
      password: ["sometimes", "nullable", "string", "max:1000"],
      secret_notes: ["sometimes", "nullable", "string", "max:5000"],
      notes: ["sometimes", "nullable", "string", "max:5000"],
      branch_id: ["sometimes", "nullable", "integer", exists("branches", "id", "deleted_at IS NULL")],
      owner_id: ["sometimes", "nullable", "integer", exists("users", "id")],
      expires_at: ["sometimes", "nullable", "date"],
    },
    { locale: req.locale },
  );
  const out: Record<string, unknown> = {};
  for (const key of ["title", "category", "url", "username", "notes"]) if (key in data) out[key] = data[key];
  for (const key of ["branch_id", "owner_id"]) if (key in data) out[key] = int(data[key]);
  if ("expires_at" in data) out.expires_at = data.expires_at === null ? null : String(data.expires_at).slice(0, 10);
  // password/secret_notes: ไม่ส่งมา = คงเดิม, ส่ง null ("") = ลบ — เข้ารหัสด้วย APP_KEY เหมือน encrypted cast
  if ("password" in data) out.password = encryptNullable(data.password as string | null);
  if ("secret_notes" in data) out.secret_notes = encryptNullable(data.secret_notes as string | null);
  return { out, plainPassword: data.password as string | null | undefined };
}

async function logAccess(req: Request, credentialId: number, action: string) {
  await insert("credential_access_logs", { credential_id: credentialId, user_id: me(req).id, action, ip: req.ip ?? null, created_at: nowDb() });
}

itDataRoutes.get("/credentials", async (req, res) => {
  vault(req);
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      category: ["nullable", `in:${CATEGORIES.join(",")}`],
      branch_id: ["nullable", "integer"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const perPage = int(f.per_page) ?? 25;
  const page = pageParam(req);
  const where = ["c.deleted_at IS NULL"];
  const params: unknown[] = [];
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

itDataRoutes.get("/credentials/:id", async (req, res) => {
  const c = await loadCredential(routeId(req));
  vault(req);
  res.json({ data: credentialJson(c) });
});

itDataRoutes.post("/credentials", async (req, res) => {
  vault(req);
  const { out, plainPassword } = await credentialInput(req, false);
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
    return newId;
  });
  // Laravel ตอบหลัง refresh() (ไม่โหลด relation) → branch/owner/updated_by เป็น null
  const c = await loadCredential(id);
  res.status(201).json({ data: credentialJson({ ...c, b_id: null, o_id: null, upd_name: null }) });
});

async function updateCredential(req: Request, res: import("express").Response) {
  const current = await loadCredential(routeId(req));
  vault(req);
  const { out, plainPassword } = await credentialInput(req, true);
  await transaction(async () => {
    const changes: Record<string, unknown> = { ...out, updated_by: me(req).id, updated_at: nowDb() };
    // password_changed_at เมื่อรหัสผ่านเปลี่ยนจริง (isDirty)
    if ("password" in out) {
      const before = current.password === null ? null : decryptNullable(current.password);
      if ((plainPassword ?? null) !== before) changes.password_changed_at = nowDb();
      else delete changes.password; // ไม่เปลี่ยน → ไม่เขียน ciphertext ใหม่
    }
    await update("credentials", changes, "id = ?", [current.id]);
    await logAccess(req, current.id, "update");
  });
  res.json({ data: credentialJson(await loadCredential(current.id)) });
}
itDataRoutes.put("/credentials/:id", updateCredential);
itDataRoutes.patch("/credentials/:id", updateCredential);

itDataRoutes.delete("/credentials/:id", async (req, res) => {
  const c = await loadCredential(routeId(req));
  vault(req);
  await logAccess(req, c.id, "delete");
  await update("credentials", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [c.id]);
  res.status(204).end();
});

/** เปิดดูรหัสผ่าน — บันทึก log ผู้เปิดดู + IP ทุกครั้ง */
itDataRoutes.post("/credentials/:id/reveal", limits.reveal, async (req, res) => {
  const c = await loadCredential(routeId(req));
  vault(req);
  await logAccess(req, c.id, "reveal");
  res.json({ data: { password: decryptNullable(c.password), secret_notes: decryptNullable(c.secret_notes) } });
});

/** ประวัติการเข้าถึง (ล่าสุด 50 รายการ) */
itDataRoutes.get("/credentials/:id/logs", async (req, res) => {
  const c = await loadCredential(routeId(req));
  vault(req);
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
    days_left: s.daysLeft,
    status: s.status,
  };
}

const CONTRACT_SELECT = "c.*, b.id AS b_id, b.name AS b_name FROM contracts c LEFT JOIN branches b ON b.id = c.branch_id AND b.deleted_at IS NULL";

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
  return out;
}

/** GET /contracts?status=active|expiring|expired&search= (+ summary, default_notify_days) */
itDataRoutes.get("/contracts", async (req, res) => {
  contracts(req);
  const f = await validate(
    req.input,
    {
      search: ["nullable", "string", "max:100"],
      status: ["nullable", "in:active,expiring,expired"],
      per_page: ["nullable", "integer", "min:1", "max:100"],
    },
    { locale: req.locale },
  );
  const defaultDays = Number(await getSetting("contract_notify_days"));
  const term = likeEscape(String(f.search ?? "").trim());
  const rows = await select<ContractRow>(
    `SELECT ${CONTRACT_SELECT} WHERE c.deleted_at IS NULL${term ? " AND (c.title LIKE ? OR c.vendor_name LIKE ? OR c.contract_no LIKE ?)" : ""} ORDER BY c.end_date`,
    term ? [`%${term}%`, `%${term}%`, `${term}%`] : [],
  );
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
  contracts(req);
  res.json({ data: contractJson(c, Number(await getSetting("contract_notify_days")), true) });
});

itDataRoutes.post("/contracts", async (req, res) => {
  contracts(req);
  const out = await contractInput(req, false);
  const now = nowDb();
  const id = await insert("contracts", { notify_enabled: true, ...out, created_by: me(req).id, created_at: now, updated_at: now });
  res.status(201).json({ data: contractJson(await loadContract(id), Number(await getSetting("contract_notify_days")), true) });
});

async function updateContract(req: Request, res: import("express").Response) {
  const current = await loadContract(routeId(req));
  contracts(req);
  const out = await contractInput(req, true);
  await update("contracts", { ...out, updated_at: nowDb() }, "id = ?", [current.id]);
  res.json({ data: contractJson(await loadContract(current.id), Number(await getSetting("contract_notify_days")), true) });
}
itDataRoutes.put("/contracts/:id", updateContract);
itDataRoutes.patch("/contracts/:id", updateContract);

itDataRoutes.delete("/contracts/:id", async (req, res) => {
  const c = await loadContract(routeId(req));
  contracts(req);
  await update("contracts", { deleted_at: nowDb(), updated_at: nowDb() }, "id = ?", [c.id]);
  res.status(204).end();
});
