import { Router } from "express";
import { config } from "../config.js";
import { first, select, update } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import type { UploadedFile } from "../lib/uploaded-file.js";
import { trans } from "../lib/i18n.js";
import { limits } from "../lib/rate-limit.js";
import { addMinutes, iso, nowDb, toDbDateTime } from "../lib/time.js";
import { createToken, deleteToken, deleteUserTokens } from "../lib/tokens.js";
import { currentPassword, makeHash, password, unique, validate, verifyHash } from "../lib/validator.js";
import { me } from "../http.js";
import { can, findUser, isLocal, roleRank, type UserRow } from "../models/user.js";
import { userResource } from "../resources.js";
import { ApiLoginError, callUpstream, loadConnection, loginWithApi, revokeApiSession } from "../services/api-auth.js";
import { notifySuperAdminLogin, type LoginMethod } from "../services/access-control.js";
import { audit } from "../services/audit.js";
import { groupsOf } from "../services/permissions.js";
import { checkCentralPin, secretGuard, verifyLoginPassword } from "../services/secret-guard.js";
import { assertNotLocked, clearLoginFailures, passwordChangedNow, passwordPolicy, passwordStatus, recordLoginFailure } from "../services/password-policy.js";
import { activeSignature, deactivateSignature, mimeOf, readSignature, saveSignature, SignatureError, signatureRequired } from "../services/signatures.js";
import type { Locale } from "../lib/i18n.js";
import {
  challengeValid, confirmSetup, consumeRecoveryCode, disableTwoFactor, issueRecoveryCodes, readChallenge, recoveryCodesLeft, signChallenge, startSetup,
  twoFactorEnabled, twoFactorRequiredFor, verifyUserTotp,
} from "../services/two-factor.js";

/** Bearer token แบบ Sanctum — AuthController + ProfileController */
export const loginRoutes = Router();
/** ต้อง login (app.ts ใส่ auth + throttle:api ให้ทุก router ที่ต่อจากนี้) */
export const authRoutes = Router();

/**
 * POST /auth/login { login (อีเมลหรือชื่อผู้ใช้) | email, password, device_name }
 * มี @ = อีเมล, ไม่มี = ชื่อผู้ใช้ — เทียบแบบไม่สนตัวพิมพ์; error อยู่ที่ช่อง email เหมือนเดิม (client เดิมใช้ต่อได้)
 */
loginRoutes.post("/auth/login", limits.login, async (req, res) => {
  const input = { ...req.input, email: req.input.login ?? req.input.email };
  const data = await validate(
    input,
    {
      email: ["required", "string", "max:255"],
      password: ["required", "string", "max:255"],
      device_name: ["required", "string", "max:100"],
    },
    { locale: req.locale },
  );

  const identifier = String(data.email).trim();
  const user = identifier.includes("@")
    ? await first<UserRow>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [identifier])
    : await first<UserRow>("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", [identifier]);
  // ข้อความเดียวกันทุกกรณี เพื่อไม่ให้เดาได้ว่ามีอีเมลนี้ในระบบหรือไม่
  // ช่องนี้ login ได้เฉพาะ LOCAL (API User ไม่มีรหัสผ่านในระบบเรา — login ผ่านต้นทางเท่านั้น)
  if (!user || !isLocal(user) || !user.is_active) throw ValidationError.withMessages({ email: trans(req.locale, "eam.auth.failed") });
  // ล็อกชั่วคราวเมื่อ login ผิดติดกันครบตามนโยบาย (services/password-policy.ts) — ระหว่างล็อกรหัสผ่านถูกก็เข้าไม่ได้
  assertNotLocked(req, user);
  if (!verifyHash(String(data.password), user.password)) {
    const locked = await recordLoginFailure(req, user);
    throw ValidationError.withMessages({ email: trans(req.locale, locked ? "eam.auth.locked" : "eam.auth.failed", { minutes: locked }) });
  }

  // 2FA: รหัสผ่านถูกแล้ว → ขอรหัสจากแอป (verify) หรือบังคับตั้ง 2FA ก่อน (setup) — ยังไม่ออก token
  if (twoFactorEnabled(user)) return void res.json({ two_factor: "verify", challenge: signChallenge(user, "verify") });
  if (await twoFactorRequiredFor(user)) return void res.json({ two_factor: "setup", challenge: signChallenge(user, "setup") });

  res.json(await issueLogin(req, user, String(data.device_name), "password"));
});

/** ออก token ของเรา (รูปแบบ response เดียวกับ /auth/login เดิม) — method = วิธียืนยันตัวตน (แจ้งเตือนเมื่อ super_admin เข้าสู่ระบบ) */
async function issueLogin(req: import("express").Request, user: UserRow, deviceName: string, method: LoginMethod) {
  await clearLoginFailures(user);
  await notifySuperAdminLogin(req, user, method);
  const expiresAt = addMinutes(new Date(), config.tokenTtlMinutes);
  const token = await createToken(user.id, deviceName, expiresAt);
  return { token: token.plainText, token_type: "Bearer", expires_at: iso(toDbDateTime(expiresAt)), user: userResource((await findUser(user.id))!) };
}

/* ---------------------------------------------------------------- login ขั้นที่ 2 (2FA — services/two-factor.ts) */

/** ใบผ่านชั่วคราวจาก /auth/login → ผู้ใช้ (หมดอายุ / ลายมือไม่ตรง / ผิดขั้นตอน = 422 ให้ login ใหม่) */
async function challengeUser(req: import("express").Request, purpose: "verify" | "setup"): Promise<UserRow> {
  const token = typeof req.input.challenge === "string" ? req.input.challenge : "";
  const c = token ? readChallenge(token) : null;
  const user = c && c.purpose === purpose ? await findUser(c.userId) : null;
  if (!c || !user || !isLocal(user) || !user.is_active || !challengeValid(token, user)) {
    throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.challenge_expired") });
  }
  assertNotLocked(req, user, "code");
  return user;
}

const actorOf = (req: import("express").Request, user: UserRow) => ({ user, ip: req.ip });

/** POST /auth/login/2fa/setup { challenge } — ผู้ดูแลระบบที่ถูกบังคับ 2FA: secret + QR สำหรับสแกน */
loginRoutes.post("/auth/login/2fa/setup", limits.twoFactor, async (req, res) => {
  const user = await challengeUser(req, "setup");
  if (twoFactorEnabled(user)) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.already_enabled") });
  res.json({ data: await startSetup(user) });
});

/**
 * POST /auth/login/2fa { challenge, code | recovery_code, device_name }
 *   verify = รหัสจากแอป หรือ recovery code (ใช้ได้ครั้งเดียว) → token
 *   setup  = รหัสแรกจากแอปที่เพิ่งสแกน → เปิด 2FA + recovery codes (แสดงครั้งเดียว) → token
 */
loginRoutes.post("/auth/login/2fa", limits.twoFactor, async (req, res) => {
  const data = await validate(
    req.input,
    { challenge: ["required", "string", "max:500"], code: ["nullable", "string", "max:20"], recovery_code: ["nullable", "string", "max:30"], device_name: ["required", "string", "max:100"] },
    { locale: req.locale },
  );
  const purpose = readChallenge(String(data.challenge))?.purpose ?? "verify";
  const user = await challengeUser(req, purpose);
  const fail = async (): Promise<never> => {
    await audit(actorOf(req, user), { action: "auth.2fa_failed", subjectType: "user", subjectId: user.id });
    // รหัส 2FA ผิดนับรวมกับรหัสผ่านผิด (ล็อกบัญชีเดียวกัน)
    const locked = await recordLoginFailure(req, user);
    throw ValidationError.withMessages({ code: trans(req.locale, locked ? "eam.auth.locked" : "eam.two_factor.invalid", { minutes: locked }) });
  };

  if (purpose === "setup") {
    if (twoFactorEnabled(user) || !data.code) return fail();
    const codes = await confirmSetup(user, String(data.code));
    if (!codes) return fail();
    await audit(actorOf(req, user), { action: "two_factor.enabled", subjectType: "user", subjectId: user.id });
    return void res.json({ ...(await issueLogin(req, user, String(data.device_name), "two_factor")), recovery_codes: codes });
  }

  if (!twoFactorEnabled(user)) return fail();
  if (data.recovery_code) {
    if (!(await consumeRecoveryCode(user, String(data.recovery_code)))) return fail();
    await audit(actorOf(req, user), { action: "two_factor.recovery_used", subjectType: "user", subjectId: user.id, after: { left: recoveryCodesLeft((await findUser(user.id))!) } });
  } else if (!data.code || !(await verifyUserTotp(user, String(data.code)))) return fail();
  res.json(await issueLogin(req, user, String(data.device_name), data.recovery_code ? "recovery_code" : "two_factor"));
});

/* ---------------------------------------------------------------- API User (login ผ่านระบบต้นทาง) */

/** GET /auth/connections — ช่องทาง login ผ่านระบบต้นทางที่เปิดอยู่ (หน้า login, ไม่ต้อง login) — ไม่มีค่าการเชื่อมต่อ/secret */
loginRoutes.get("/auth/connections", async (_req, res) => {
  const rows = await select<{ id: number; name: string; register_url: string | null; forgot_password_url: string | null }>(
    "SELECT id, name, register_url, forgot_password_url FROM api_connections WHERE is_enabled = true ORDER BY name, id",
  );
  res.json({ data: rows });
});

/**
 * GET /auth/connections/:id/status — สถานะการเชื่อมต่อต้นทางสำหรับหน้า login (ไม่ต้อง login)
 * เรียก health_path (เช่น /health ของ STEC) แล้ว cache ผลต่อการเชื่อมต่อ STATUS_CACHE_MS
 * → ต้นทางถูกเรียกไม่เกิน 1 ครั้ง/นาที ไม่ว่าจะมีคนเปิดหน้า login กี่คน — คืนแค่ online/offline/unknown (ไม่มีรายละเอียด error/เนื้อหาต้นทาง)
 */
const STATUS_CACHE_MS = 60_000;
type ConnectionStatus = "online" | "offline" | "unknown";
const statusCache = new Map<number, { status: ConnectionStatus; checkedAt: number; pending?: Promise<ConnectionStatus> }>();

export function clearConnectionStatusCache(): void {
  statusCache.clear();
}

async function connectionStatus(id: number): Promise<{ status: ConnectionStatus; checkedAt: number } | null> {
  const conn = await loadConnection(id);
  if (!conn || !conn.is_enabled) return null;
  if (!conn.health_path) return { status: "unknown", checkedAt: Date.now() };
  const hit = statusCache.get(id);
  if (hit && Date.now() - hit.checkedAt < STATUS_CACHE_MS) return hit;
  if (hit?.pending) return { status: await hit.pending, checkedAt: Date.now() };

  const healthPath = conn.health_path;
  const pending = callUpstream(conn, { method: "GET", path: healthPath })
    .then((r): ConnectionStatus => (r.status >= 200 && r.status < 300 ? "online" : "offline"))
    .catch((): ConnectionStatus => "offline");
  statusCache.set(id, { status: hit?.status ?? "unknown", checkedAt: hit?.checkedAt ?? 0, pending });
  const status = await pending;
  const entry = { status, checkedAt: Date.now() };
  statusCache.set(id, entry);
  return entry;
}

loginRoutes.get("/auth/connections/:id/status", async (req, res) => {
  const id = String(req.params.id);
  if (!/^\d+$/.test(id)) throw notFound();
  const r = await connectionStatus(Number(id));
  if (!r) throw notFound();
  res.json({ data: { status: r.status, checked_at: new Date(r.checkedAt).toISOString() } });
});

/** ข้อความ login ไม่สำเร็จ — invalid ใช้ข้อความกลางเสมอ; ประเภทอื่นใช้ข้อความที่ admin ตั้งไว้ (ถ้ามี) */
function apiLoginMessage(locale: Locale, e: ApiLoginError): string {
  if (e.kind === "invalid") return trans(locale, "eam.api_auth.failed");
  const custom = locale === "th" ? e.custom?.message_th : e.custom?.message_en;
  return custom?.trim() || trans(locale, `eam.api_auth.${e.kind}`);
}

/**
 * POST /auth/api-login { connection_id, username, password, device_name }
 * login ที่ต้นทาง → JIT สร้าง/อัปเดตผู้ใช้ → token ของเรา (รูปแบบ response เดียวกับ /auth/login)
 * รหัสผ่านส่งต่อไปต้นทางเท่านั้น — ไม่เก็บ/ไม่ log
 */
loginRoutes.post("/auth/api-login", limits.apiLogin, async (req, res) => {
  const data = await validate(
    req.input,
    {
      connection_id: ["required", "integer"],
      username: ["required", "string", "max:255"],
      password: ["required", "string", "max:255"],
      device_name: ["required", "string", "max:100"],
    },
    { locale: req.locale },
  );
  try {
    const conn = await loadConnection(Number(data.connection_id));
    if (!conn) throw new ApiLoginError("connection_disabled");
    const session = await loginWithApi(conn, String(data.username), String(data.password), String(data.device_name), req);
    await notifySuperAdminLogin(req, session.user, "api");
    res.json({ token: session.plainText, token_type: "Bearer", expires_at: iso(toDbDateTime(session.expiresAt)), user: userResource(session.user) });
  } catch (e) {
    if (!(e instanceof ApiLoginError)) throw e;
    throw ValidationError.withMessages({ username: apiLoginMessage(req.locale, e) });
  }
});

/**
 * เป็นผู้อนุมัติใบแจ้งงานได้ไหม: ตำแหน่งสูงกว่าพนักงาน (ผู้แจ้งเลือกเป็นผู้อนุมัติได้) / อนุมัติแทนได้ /
 * อยู่ในสายอนุมัติ / เป็นหัวหน้าตามสายบังคับบัญชาของใคร / เคยถูกเลือกเป็นผู้อนุมัติ
 */
async function canApprove(u: UserRow): Promise<boolean> {
  if (roleRank(u.role) > roleRank("viewer") || can(u, "tickets.approve_any")) return true;
  return Boolean(
    await first(
      `SELECT 1 AS x FROM approval_step_approvers WHERE user_id = ?
        UNION ALL SELECT 1 FROM users WHERE supervisor_id = ? AND is_active = true
        UNION ALL SELECT 1 FROM it_tickets WHERE approver_id = ? LIMIT 1`,
      [u.id, u.id, u.id],
    ),
  );
}

authRoutes.get("/auth/me", async (req, res) => {
  const u = me(req);
  const branch = u.branch_id ? await first<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = ? AND deleted_at IS NULL", [u.branch_id]) : null;
  const supervisor = u.supervisor_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [u.supervisor_id]) : null;
  // API User: ชื่อระบบต้นทาง + ลิงก์เปลี่ยนรหัสผ่านที่ต้นทาง (ระบบเราไม่มีรหัสผ่านของผู้ใช้กลุ่มนี้)
  const external =
    u.type === "API" && u.connection_id
      ? await first<{ name: string; change_password_url: string | null }>("SELECT name, change_password_url FROM api_connections WHERE id = ?", [u.connection_id])
      : null;
  res.json({
    data: {
      ...userResource(u, { branch, supervisor, signature_id: (await activeSignature(u.id))?.id ?? null }, u.id),
      // สิทธิ์จริงของผู้ใช้ — frontend ใช้ซ่อน/แสดงเมนูและปุ่ม (สิทธิ์จริงตรวจที่ API ทุก request)
      permissions: [...(u.perms ?? [])].sort(),
      // กลุ่มที่มีผล (ตำแหน่ง + กลุ่มที่มอบเพิ่ม) — frontend ใช้กับการซ่อนเมนู/ปุ่มรายกลุ่ม
      groups: await groupsOf(u),
      // เมนู "รอฉันอนุมัติ" — แสดงเฉพาะผู้ที่มีงานอนุมัติได้จริง
      can_approve: await canApprove(u),
      // เปิดบังคับลายเซ็น — ไม่มีลายเซ็น (signature_id null) = หน้าเว็บเตือนและปิดปุ่มบันทึก/อนุมัติเอกสาร
      signature_required: await signatureRequired(),
      // วันหมดอายุรหัสผ่าน (LOCAL + เปิดบังคับเปลี่ยน) — หมดอายุแล้วหน้าเว็บพาไปหน้าเปลี่ยนรหัสผ่าน
      ...passwordStatus(u, await passwordPolicy()),
      ...(external ? { external_connection: external } : {}),
    },
  });
});

/* ---------------------------------------------------------------- 2FA ของฉัน (หน้าโปรไฟล์) */

authRoutes.get("/auth/2fa", async (req, res) => {
  const u = me(req);
  res.json({
    data: {
      available: isLocal(u),
      enabled: twoFactorEnabled(u),
      confirmed_at: iso(u.two_factor_confirmed_at ?? null),
      recovery_codes_left: recoveryCodesLeft(u),
      required: await twoFactorRequiredFor(u),
    },
  });
});

/** POST /auth/2fa/setup { password } — secret ใหม่ + QR (ยังไม่มีผลจนยืนยันรหัสแรก) */
authRoutes.post("/auth/2fa/setup", limits.twoFactor, async (req, res) => {
  const u = me(req);
  if (!isLocal(u)) throw ValidationError.withMessages({ password: trans(req.locale, "eam.two_factor.local_only") });
  if (twoFactorEnabled(u)) throw ValidationError.withMessages({ password: trans(req.locale, "eam.two_factor.already_enabled") });
  const data = await validate(req.input, { password: ["required", "string", "max:255"] }, { locale: req.locale });
  if (!u.password || !verifyHash(String(data.password), u.password)) throw ValidationError.withMessages({ password: trans(req.locale, "eam.secret_guard.wrong_password") });
  res.json({ data: await startSetup(u) });
});

/** POST /auth/2fa/confirm { code } — เปิดใช้ + recovery codes (แสดงครั้งเดียว) */
authRoutes.post("/auth/2fa/confirm", limits.twoFactor, async (req, res) => {
  const u = me(req);
  if (twoFactorEnabled(u) || !u.two_factor_secret) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.already_enabled") });
  const data = await validate(req.input, { code: ["required", "string", "max:20"] }, { locale: req.locale });
  const codes = await confirmSetup(u, String(data.code));
  if (!codes) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.invalid") });
  await audit(req, { action: "two_factor.enabled", subjectType: "user", subjectId: u.id });
  res.json({ data: { recovery_codes: codes } });
});

/** POST /auth/2fa/recovery-codes { code } — สร้างชุดใหม่ (ชุดเดิมใช้ไม่ได้) */
authRoutes.post("/auth/2fa/recovery-codes", limits.twoFactor, async (req, res) => {
  const u = me(req);
  if (!twoFactorEnabled(u)) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.not_enabled") });
  const data = await validate(req.input, { code: ["required", "string", "max:20"] }, { locale: req.locale });
  if (!(await verifyUserTotp(u, String(data.code)))) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.invalid") });
  const codes = await issueRecoveryCodes(u.id);
  await audit(req, { action: "two_factor.recovery_regenerated", subjectType: "user", subjectId: u.id });
  res.json({ data: { recovery_codes: codes } });
});

/** DELETE /auth/2fa { password, code } — ปิด 2FA (ถูกบังคับใช้อยู่ = ปิดไม่ได้) */
authRoutes.delete("/auth/2fa", limits.twoFactor, async (req, res) => {
  const u = me(req);
  if (!twoFactorEnabled(u)) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.not_enabled") });
  if (await twoFactorRequiredFor(u)) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.required") });
  const data = await validate(req.input, { password: ["required", "string", "max:255"], code: ["required", "string", "max:20"] }, { locale: req.locale });
  if (!u.password || !verifyHash(String(data.password), u.password)) throw ValidationError.withMessages({ password: trans(req.locale, "eam.secret_guard.wrong_password") });
  if (!(await verifyUserTotp(u, String(data.code)))) throw ValidationError.withMessages({ code: trans(req.locale, "eam.two_factor.invalid") });
  await disableTwoFactor(u.id);
  await audit(req, { action: "two_factor.disabled", subjectType: "user", subjectId: u.id });
  res.status(204).end();
});

/** เพิกถอนเฉพาะ token ของอุปกรณ์ที่เรียก (API User: แจ้ง logout ที่ต้นทางด้วยถ้ามี endpoint) */
authRoutes.post("/auth/logout", async (req, res) => {
  const u = me(req);
  if (u.type === "API") await revokeApiSession(req.tokenId!, u);
  await deleteToken(req.tokenId!);
  res.status(204).end();
});

/**
 * POST /auth/reauth { password } | { pin } — ยืนยันตัวตนซ้ำก่อนเปิดดูข้อมูลลับ (services/secret-guard.ts)
 * วิธีตามหน้าตั้งค่า: รหัสผ่าน login ของตัวเอง หรือ PIN กลาง (ผิดติดกัน 5 ครั้ง = ล็อกคนนั้น 15 นาที)
 * ผ่านแล้วบันทึกเวลาไว้ที่ token (session) นี้ — ไม่ผ่าน = บันทึก audit auth.reauth_failed
 */
authRoutes.post("/auth/reauth", limits.reauth, async (req, res) => {
  const u = me(req);
  const g = await secretGuard();
  if (g.reauth_method === "pin") {
    const data = await validate(req.input, { pin: ["required", "string", "max:64"] }, { locale: req.locale });
    try {
      await checkCentralPin(req, u, String(data.pin));
    } catch (e) {
      await audit(req, { action: "auth.reauth_failed", subjectType: "user", subjectId: u.id, after: { method: "pin" } });
      throw e;
    }
  } else {
    const data = await validate(req.input, { password: ["required", "string", "max:255"] }, { locale: req.locale });
    if (!(await verifyLoginPassword(req, u, String(data.password)))) {
      await audit(req, { action: "auth.reauth_failed", subjectType: "user", subjectId: u.id, after: { method: "password" } });
      throw ValidationError.withMessages({ password: trans(req.locale, "eam.secret_guard.wrong_password") });
    }
  }
  await update("personal_access_tokens", { reauth_at: nowDb() }, "id = ?", [req.tokenId!]);
  res.status(204).end();
});

/** PATCH /auth/me — แก้ชื่อ/อีเมลของตัวเอง (role/สถานะแก้ไม่ได้) */
authRoutes.patch("/auth/me", async (req, res) => {
  const u = me(req);
  const data = await validate(
    req.input,
    {
      name: ["sometimes", "required", "string", "max:255"],
      email: ["sometimes", "required", "string", "email", "max:255", unique("users", "email", u.id)],
    },
    { locale: req.locale },
  );
  const changes: Record<string, unknown> = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.email !== undefined) changes.email = String(data.email).toLowerCase();
  if (Object.keys(changes).length) await update("users", { ...changes, updated_at: nowDb() }, "id = ?", [u.id]);
  res.json({ data: userResource((await findUser(u.id))!, {}, u.id) });
});

/* ---------------------------------------------------------------- ลายเซ็นของฉัน (services/signatures.ts) */

/** ลายเซ็นใช้ได้เฉพาะเจ้าของ และต้องมีสิทธิ์ signature.manage_own (ตั้งต้นทุกกลุ่ม) */
const ownSignature = (req: import("express").Request) => {
  const u = me(req);
  authorize(can(u, "signature.manage_own"));
  return u;
};

/** GET /auth/me/signature — รูปลายเซ็นของตัวเอง (ถอดรหัสที่ backend) */
authRoutes.get("/auth/me/signature", async (req, res) => {
  const row = await activeSignature(ownSignature(req).id);
  const data = row ? await readSignature(row) : null;
  if (!row || !data) throw notFound();
  res.setHeader("Content-Type", mimeOf(row));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});

/**
 * POST|PUT /auth/me/signature (multipart: signature, source = UPLOAD | DRAW)
 * PNG/JPG ≤ 1MB (ตรวจจากเนื้อไฟล์) → crop + ย่อ + re-encode PNG → เก็บเข้ารหัส; อันเดิมเป็นประวัติ (is_active = false)
 */
async function saveOwnSignature(req: import("express").Request, res: import("express").Response) {
  const u = ownSignature(req);
  const data = await validate(
    req.input,
    { signature: ["required", "image", "mimes:png,jpg,jpeg", "max:1024"], source: ["sometimes", "nullable", "in:UPLOAD,DRAW"] },
    { locale: req.locale },
  );
  try {
    const file = data.signature as UploadedFile;
    const row = await saveSignature(u.id, file.buffer, data.source === "DRAW" ? "DRAW" : "UPLOAD", req);
    res.json({ data: userResource((await findUser(u.id))!, { signature_id: row.id }, u.id) });
  } catch (e) {
    if (!(e instanceof SignatureError)) throw e;
    throw ValidationError.withMessages({ signature: trans(req.locale, `eam.signature.${e.reason}`) });
  }
}
authRoutes.post("/auth/me/signature", limits.signature, saveOwnSignature);
authRoutes.put("/auth/me/signature", limits.signature, saveOwnSignature);

/** DELETE /auth/me/signature — ลบลายเซ็น (ปิดใช้งาน — ใบงานที่ส่งไปแล้วยังมีสำเนาของตัวเอง) */
authRoutes.delete("/auth/me/signature", async (req, res) => {
  await deactivateSignature(ownSignature(req).id, req);
  res.status(204).end();
});

/** PUT /auth/password — เปลี่ยนรหัสผ่าน แล้วเพิกถอน token ของอุปกรณ์อื่นทั้งหมด (เฉพาะ LOCAL — API User เปลี่ยนที่ระบบต้นทาง) */
authRoutes.put("/auth/password", limits.login, async (req, res) => {
  const u = me(req);
  authorize(isLocal(u));
  await validate(
    req.input,
    {
      current_password: ["required", "string", currentPassword(u.password)],
      password: ["required", "string", "confirmed", "different:current_password", password(8, { letters: true, numbers: true })],
    },
    { locale: req.locale },
  );
  await update("users", { password: makeHash(req.input.password, config.bcryptRounds), ...passwordChangedNow(), updated_at: nowDb() }, "id = ?", [u.id]);
  await deleteUserTokens(u.id, req.tokenId);
  res.status(204).end();
});
