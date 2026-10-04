import { Router } from "express";
import { config } from "../config.js";
import { exec, first, update } from "../db.js";
import { notFound, ValidationError } from "../lib/errors.js";
import type { UploadedFile } from "../lib/uploaded-file.js";
import { deleteStored, readStored, storeUserSignature } from "../services/ticket-files.js";
import { trans } from "../lib/i18n.js";
import { limits } from "../lib/rate-limit.js";
import { addMinutes, iso, nowDb, toDbDateTime } from "../lib/time.js";
import { createToken, deleteToken, deleteUserTokens } from "../lib/tokens.js";
import { currentPassword, makeHash, password, unique, validate, verifyHash } from "../lib/validator.js";
import { me } from "../http.js";
import { findUser, type UserRow } from "../models/user.js";
import { userResource } from "../resources.js";

/** Bearer token แบบ Sanctum — AuthController + ProfileController */
export const loginRoutes = Router();
/** ต้อง login (app.ts ใส่ auth + throttle:api ให้ทุก router ที่ต่อจากนี้) */
export const authRoutes = Router();

loginRoutes.post("/auth/login", limits.login, async (req, res) => {
  const data = await validate(
    req.input,
    {
      email: ["required", "string", "email", "max:255"],
      password: ["required", "string", "max:255"],
      device_name: ["required", "string", "max:100"],
    },
    { locale: req.locale },
  );

  // อีเมลเก็บเป็นตัวพิมพ์เล็ก — เทียบแบบไม่สนตัวพิมพ์เผื่อข้อมูลเดิม
  const user = await first<UserRow>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [String(data.email)]);
  // ข้อความเดียวกันทุกกรณี เพื่อไม่ให้เดาได้ว่ามีอีเมลนี้ในระบบหรือไม่
  if (!user || !user.is_active || !verifyHash(String(data.password), user.password)) {
    throw ValidationError.withMessages({ email: trans(req.locale, "eam.auth.failed") });
  }

  const expiresAt = addMinutes(new Date(), config.tokenTtlMinutes);
  const token = await createToken(user.id, String(data.device_name), expiresAt);

  res.json({
    token: token.plainText,
    token_type: "Bearer",
    expires_at: iso(toDbDateTime(expiresAt)),
    user: userResource(user),
  });
});

authRoutes.get("/auth/me", async (req, res) => {
  const u = me(req);
  const branch = u.branch_id ? await first<{ id: number; name: string }>("SELECT id, name FROM branches WHERE id = ? AND deleted_at IS NULL", [u.branch_id]) : null;
  const supervisor = u.supervisor_id ? await first<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [u.supervisor_id]) : null;
  res.json({ data: userResource(u, { branch, supervisor }, u.id) });
});

/** เพิกถอนเฉพาะ token ของอุปกรณ์ที่เรียก */
authRoutes.post("/auth/logout", async (req, res) => {
  await deleteToken(req.tokenId!);
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

/* ---------------------------------------------------------------- ลายเซ็นในโปรไฟล์ (แสตมป์ลงใบแจ้งงาน) */

/** GET /auth/me/signature — รูปลายเซ็นของตัวเอง */
authRoutes.get("/auth/me/signature", async (req, res) => {
  const path = me(req).signature_path;
  if (!path) throw notFound();
  const file = await readStored(path);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
  res.send(file.data);
});

/** POST /auth/me/signature (multipart: signature) — PNG/JPG/WebP ≤ 1MB, แทนที่ของเดิม */
authRoutes.post("/auth/me/signature", async (req, res) => {
  const u = me(req);
  const data = await validate(
    req.input,
    { signature: ["required", "image", "mimes:png,jpg,jpeg,webp", "max:1024"] },
    { locale: req.locale },
  );
  const path = await storeUserSignature(u.id, data.signature as UploadedFile);
  await update("users", { signature_path: path, updated_at: nowDb() }, "id = ?", [u.id]);
  await deleteStored(u.signature_path);
  res.json({ data: userResource((await findUser(u.id))!, {}, u.id) });
});

/** DELETE /auth/me/signature — ลบลายเซ็น (ใบงานที่ส่งไปแล้วยังมีสำเนาของตัวเอง) */
authRoutes.delete("/auth/me/signature", async (req, res) => {
  const u = me(req);
  await update("users", { signature_path: null, updated_at: nowDb() }, "id = ?", [u.id]);
  await deleteStored(u.signature_path);
  res.status(204).end();
});

/** PUT /auth/password — เปลี่ยนรหัสผ่าน แล้วเพิกถอน token ของอุปกรณ์อื่นทั้งหมด */
authRoutes.put("/auth/password", limits.login, async (req, res) => {
  const u = me(req);
  await validate(
    req.input,
    {
      current_password: ["required", "string", currentPassword(u.password)],
      password: ["required", "string", "confirmed", "different:current_password", password(8, { letters: true, numbers: true })],
    },
    { locale: req.locale },
  );
  await exec("UPDATE users SET password = ?, updated_at = ? WHERE id = ?", [makeHash(req.input.password, config.bcryptRounds), nowDb(), u.id]);
  await deleteUserTokens(u.id, req.tokenId);
  res.status(204).end();
});
