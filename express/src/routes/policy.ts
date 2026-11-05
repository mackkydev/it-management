import { Router, type Response } from "express";
import { exec, first } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb } from "../lib/time.js";
import { bool, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { putSetting } from "../services/settings.js";
import { signPolicyAcceptances } from "../services/signatures.js";
import { acceptanceOf, parseSections, POLICY_DISPLAYS, POLICY_MANAGE, policyActive, policyFileJson, policyFilesOf, systemPolicy, type PolicyFileRow, type SystemPolicy } from "../services/system-policy.js";
import { readStored } from "../services/ticket-files.js";

/**
 * นโยบายของระบบฝั่งผู้ใช้ (services/system-policy.ts) — จัดการแต่ละฉบับอยู่ที่ routes/policy-versions.ts
 *   GET  /policy               ฉบับที่แสดงอยู่ + สถานะการยอมรับของฉัน (ทุกคน — ใช้ได้ระหว่างยังไม่ยอมรับ)
 *   GET  /policy/previous      ฉบับที่ประกาศใช้ก่อนหน้าฉบับที่แสดงอยู่ 1 ฉบับ (data: null = ไม่มี)
 *   POST /policy/accept        ยอมรับฉบับที่แสดงอยู่ { version } → บันทึกวันเวลา + IP (audit policy.accepted)
 *   PUT  /policy/options       เปิด-ปิด + ให้ยอมรับที่หน้า login / หลัง login (settings.manage)
 *   GET  /policy/documents/{user}[/signature][?version=]  เอกสารการยอมรับของผู้ใช้ (เจ้าของ / users.view / policy.manage) — ไม่ระบุฉบับ = ฉบับล่าสุดที่ยอมรับ
 *   GET  /policy/files/{id}    ผู้จัดการ = ทุกไฟล์, คนอื่น = เฉพาะฉบับที่เคยประกาศใช้
 *   GET  /policy/public[/files/{id}]  ไม่ต้อง login — เฉพาะเมื่อเปิดใช้และตั้งแสดงที่หน้า login, เฉพาะไฟล์ของฉบับที่แสดงอยู่
 */
export const policyRoutes = Router();
export const publicPolicyRoutes = Router();

const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

const findFile = async (id: string) => {
  const file = /^\d+$/.test(id) ? await first<PolicyFileRow>("SELECT * FROM policy_files WHERE id = ?", [Number(id)]) : null;
  if (!file) throw notFound();
  return file;
};

async function sendFile(res: Response, file: PolicyFileRow, download: boolean) {
  const stored = await readStored(file.path);
  const inline = !download && INLINE_MIME.test(file.mime);
  const ascii = file.original_name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", file.mime === "text/plain" ? "text/plain; charset=UTF-8" : file.mime);
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(file.original_name)}`);
  res.send(stored.data);
}

/** แสดงที่หน้า login อยู่จริงไหม — ไม่ใช่ = ไม่เปิดเผยเนื้อหาให้คนที่ยังไม่ login */
const loginPolicy = async (): Promise<SystemPolicy | null> => {
  const p = await systemPolicy();
  return policyActive(p) && p.display === "login" ? p : null;
};

publicPolicyRoutes.get("/policy/public", async (_req, res) => {
  const p = await loginPolicy();
  if (!p) return res.json({ data: null });
  res.json({ data: { version: p.version, sections: p.sections, files: (await policyFilesOf([p.version])).map((f) => policyFileJson(f, "/policy/public/files")) } });
});

publicPolicyRoutes.get("/policy/public/files/:id", async (req, res) => {
  const p = await loginPolicy();
  if (!p) throw notFound();
  const file = await findFile(req.params.id);
  if (Number(file.version) !== p.version) throw notFound();
  await sendFile(res, file, "download" in req.query);
});

const titleOf = async (version: number) => (await first<{ title: string }>("SELECT title FROM policy_versions WHERE version = ?", [version]))?.title ?? "";

policyRoutes.get("/policy", async (req, res) => {
  const p = await systemPolicy();
  const accepted = policyActive(p) ? await acceptanceOf(me(req).id, p.version) : null;
  res.json({ data: { ...p, title: await titleOf(p.version), files: (await policyFilesOf([p.version])).map((f) => policyFileJson(f)) }, active: policyActive(p), accepted_at: accepted?.accepted_at ?? null });
});

policyRoutes.get("/policy/previous", async (_req, res) => {
  const p = await systemPolicy();
  const row = policyActive(p)
    ? await first<{ version: number; title: string; sections: unknown; published_at: string | null }>(
        "SELECT version, title, sections, published_at FROM policy_versions WHERE version < ? AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1",
        [p.version],
      )
    : null;
  if (!row) return res.json({ data: null });
  const version = Number(row.version);
  res.json({ data: { version, title: row.title, sections: parseSections(row.sections), published_at: iso(row.published_at), files: (await policyFilesOf([version])).map((f) => policyFileJson(f)) } });
});

policyRoutes.post("/policy/accept", async (req, res) => {
  const u = me(req);
  const data = await validate(req.input, { version: ["required", "integer"], user_agent: ["nullable", "string"] }, { locale: req.locale });
  const p = await systemPolicy();
  // นโยบายถูกแก้ระหว่างอ่าน (เปลี่ยนฉบับ) = ต้องอ่านฉบับใหม่ก่อน
  if (!policyActive(p) || Number(data.version) !== p.version) throw ValidationError.withMessages({ version: trans(req.locale, "eam.policy.version_changed") });
  const now = nowDb();
  const userAgent = String(data.user_agent ?? req.get("User-Agent") ?? "").slice(0, 255) || null;
  // ยอมรับซ้ำ (กดสองครั้ง) = คงวันเวลาครั้งแรก
  const result = await exec(
    "INSERT IGNORE INTO policy_acceptances (user_id, version, accepted_at, ip, user_agent, name_stamp) VALUES (?, ?, ?, ?, ?, ?)",
    [u.id, p.version, now, req.ip ?? null, userAgent, u.name],
  );
  if (result.rowCount) {
    await audit(req, { action: "policy.accepted", subjectType: "policy", subjectId: p.version, after: { version: p.version } });
    // ประทับลายเซ็นถ้ามีแล้ว — ยังไม่มี = เติมให้ตอนอัปโหลดลายเซ็น
    await signPolicyAcceptances(u.id, req);
  }
  res.json({ data: { version: p.version, accepted_at: (await acceptanceOf(u.id, p.version))!.accepted_at } });
});

policyRoutes.put("/policy/options", async (req, res) => {
  const u = me(req);
  authorize(can(u, "settings.manage"));
  const data = await validate(req.input, { enabled: ["required", "boolean"], display: ["required", `in:${POLICY_DISPLAYS.join(",")}`] }, { locale: req.locale });
  const before = await systemPolicy();
  const enabled = bool(data.enabled);
  if (enabled && !before.sections.length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.sections_required") });
  const after = { ...before, enabled, display: data.display as SystemPolicy["display"] };
  await putSetting("system_policy", after, u.id);
  await audit(req, { action: "settings.policy_options", subjectType: "settings", subjectId: "system_policy", before: { enabled: before.enabled, display: before.display }, after: { enabled, display: after.display } });
  res.json({ data: after });
});

policyRoutes.get("/policy/files/:id", async (req, res) => {
  const file = await findFile(req.params.id);
  // ร่างที่ยังไม่เคยประกาศใช้ = เฉพาะผู้จัดการ
  if (!can(me(req), POLICY_MANAGE)) {
    const published = file.version === null ? null : await first("SELECT 1 FROM policy_versions WHERE version = ? AND published_at IS NOT NULL", [file.version]);
    if (!published) throw notFound();
  }
  await sendFile(res, file, "download" in req.query);
});

interface AcceptanceRow {
  version: number;
  accepted_at: string;
  ip: string | null;
  name_stamp: string | null;
  signature_path: string | null;
}
/** การยอมรับของผู้ใช้: ระบุฉบับ = ฉบับนั้น, ไม่ระบุ = ล่าสุด */
const acceptanceFor = (userId: number, version: number | null) =>
  first<AcceptanceRow>(
    `SELECT version, accepted_at, ip, name_stamp, signature_path FROM policy_acceptances WHERE user_id = ? ${version === null ? "" : "AND version = ?"} ORDER BY version DESC LIMIT 1`,
    version === null ? [userId] : [userId, version],
  );

const versionQuery = (req: import("express").Request): number | null => (typeof req.query.version === "string" && /^\d+$/.test(req.query.version) ? Number(req.query.version) : null);

/** เปิดเอกสารของผู้ใช้ได้ไหม: เจ้าของ / ดูหรือจัดการผู้ใช้ได้ (ตรงกับผู้ที่เห็นคอลัมน์ในหน้าผู้ใช้) / จัดการนโยบาย */
function documentUser(req: import("express").Request): number {
  const u = me(req);
  const id = /^\d+$/.test(String(req.params.user)) ? Number(req.params.user) : NaN;
  if (Number.isNaN(id)) throw notFound();
  authorize(id === u.id || ["users.view", "users.create", "users.update", "users.delete", "settings.manage", POLICY_MANAGE].some((key) => can(u, key)));
  return id;
}

policyRoutes.get("/policy/documents/:user", async (req, res) => {
  const id = documentUser(req);
  const user = await first<{ id: number; name: string; email: string | null; job_title: string | null; department: string | null; branch: string | null }>(
    "SELECT u.id, u.name, u.email, u.job_title, u.department, b.name AS branch FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?",
    [id],
  );
  if (!user) throw notFound();
  const asked = versionQuery(req);
  const accepted = await acceptanceFor(id, asked);
  const p = await systemPolicy();
  const version = accepted?.version ?? asked ?? p.version;
  // เนื้อหาของฉบับนั้น — ยังไม่มีสำเนา = ฉบับปัจจุบัน
  const snapshot = await first<{ sections: unknown }>("SELECT sections FROM policy_versions WHERE version = ?", [version]);
  res.json({
    data: {
      user: { ...user, id: Number(user.id) },
      version: Number(version),
      sections: snapshot ? parseSections(snapshot.sections) : p.sections,
      accepted_at: accepted ? iso(accepted.accepted_at) : null,
      ip: accepted?.ip ?? null,
      name_stamp: accepted?.name_stamp ?? null,
      signature_url: accepted?.signature_path ? `/policy/documents/${id}/signature${asked === null ? "" : `?version=${asked}`}` : null,
    },
  });
});

policyRoutes.get("/policy/documents/:user/signature", async (req, res) => {
  const id = documentUser(req);
  const accepted = await acceptanceFor(id, versionQuery(req));
  if (!accepted?.signature_path) throw notFound();
  const stored = await readStored(accepted.signature_path);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(stored.data);
});
