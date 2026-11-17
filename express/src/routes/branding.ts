import { Router } from "express";
import { authorize, notFound } from "../lib/errors.js";
import type { UploadedFile } from "../lib/uploaded-file.js";
import { validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { getSetting, putSetting } from "../services/settings.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";

/**
 * โลโก้ของระบบ (แสดงหน้าชื่อ IT-SYSTEM ในเมนู) — ตั้งที่หน้า ตั้งค่าระบบ (สิทธิ์ settings.manage)
 *   GET    /branding/logo     (ไม่ต้อง login) รูปโลโก้ — ไม่มี = 404 (frontend แสดง icon เดิม)
 *   GET    /branding          (ไม่ต้อง login — หน้า login ใช้ด้วย) ชื่อระบบ + ข้อความใต้ชื่อ ว่าง = ใช้ค่าตั้งต้นของหน้าเว็บ
 *   PUT    /settings/branding { name, tagline }
 *   POST   /settings/logo     multipart: logo — PNG/JPG/WebP ≤ 1MB (ไม่รับ SVG เพื่อกันสคริปต์ฝังในไฟล์)
 *   DELETE /settings/logo
 * เก็บไฟล์ใน storage/private/branding/ — path + เวอร์ชันอยู่ใน app_settings (logo_path, logo_version)
 */
export const publicBrandingRoutes = Router();
export const brandingRoutes = Router();

publicBrandingRoutes.get("/branding/logo", async (_req, res) => {
  const path = await getSetting("logo_path");
  if (!path) throw notFound();
  const file = await readStored(path);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.data);
});

publicBrandingRoutes.get("/branding", async (_req, res) => {
  res.json({ data: { name: await getSetting("brand_name"), tagline: await getSetting("brand_tagline") } });
});

/** ชื่อแสดงบรรทัดเดียว: ตัดช่องว่างหัวท้าย/ซ้อน และขึ้นบรรทัดใหม่ */
const oneLine = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

brandingRoutes.put("/settings/branding", async (req, res) => {
  authorize(can(me(req), "settings.manage"));
  const data = await validate(req.input, { name: ["nullable", "string", "max:30"], tagline: ["nullable", "string", "max:60"] }, { locale: req.locale });
  const before = { name: await getSetting("brand_name"), tagline: await getSetting("brand_tagline") };
  const after = { name: oneLine(data.name), tagline: oneLine(data.tagline) };
  await putSetting("brand_name", after.name, me(req).id);
  await putSetting("brand_tagline", after.tagline, me(req).id);
  await audit(req, { action: "settings.branding_updated", subjectType: "settings", subjectId: "branding", before, after });
  res.json({ data: after });
});

brandingRoutes.post("/settings/logo", async (req, res) => {
  authorize(can(me(req), "settings.manage"));
  const data = await validate(req.input, { logo: ["required", "image", "mimes:png,jpg,jpeg,webp", "max:1024"] }, { locale: req.locale });
  const previous = await getSetting("logo_path");
  const stored = await storeUploadIn("branding", data.logo as UploadedFile);
  const version = String(Date.now());
  await putSetting("logo_path", stored.path, me(req).id);
  await putSetting("logo_version", version, me(req).id);
  if (previous) await deleteStored(previous);
  await audit(req, { action: "settings.logo_updated", subjectType: "settings", subjectId: "logo", after: { logo_version: version } });
  res.json({ data: { logo_version: version } });
});

brandingRoutes.delete("/settings/logo", async (req, res) => {
  authorize(can(me(req), "settings.manage"));
  const previous = await getSetting("logo_path");
  await putSetting("logo_path", null, me(req).id);
  await putSetting("logo_version", null, me(req).id);
  if (previous) await deleteStored(previous);
  await audit(req, { action: "settings.logo_removed", subjectType: "settings", subjectId: "logo" });
  res.status(204).end();
});
