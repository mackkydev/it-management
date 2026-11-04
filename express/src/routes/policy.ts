import { Router, type Response } from "express";
import { exec, first, insert, select, transaction } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { bool, validate, type Rule } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { putSetting } from "../services/settings.js";
import { signPolicyAcceptances } from "../services/signatures.js";
import { acceptanceOf, MAX_POLICY_SECTIONS, POLICY_DISPLAYS, policyActive, systemPolicy, type PolicySection, type SystemPolicy } from "../services/system-policy.js";
import { deleteStored, readStored, storeUploadIn } from "../services/ticket-files.js";

/**
 * นโยบายของระบบ (services/system-policy.ts)
 *   GET  /policy               เนื้อหา + สถานะการยอมรับของฉัน (ทุกคน — ใช้ได้ระหว่างยังไม่ยอมรับ)
 *   POST /policy/accept        ยอมรับเวอร์ชันปัจจุบัน { version } → บันทึกวันเวลา + IP (audit policy.accepted)
 *   PUT  /policy               แก้เนื้อหา / เปิด-ปิด / ให้ทุกคนยอมรับใหม่ (settings.manage)
 *   PUT  /policy/options       เปิด-ปิด + ให้ยอมรับที่หน้า login / หลัง login (settings.manage)
 *   GET  /policy/documents/{user}[/signature]  เอกสารการยอมรับของผู้ใช้ (เจ้าของ / users.view / settings.manage)
 *   POST /policy/files, DELETE /policy/files/{id}  ไฟล์แนบประกาศ (settings.manage), GET /policy/files/{id} ผู้ใช้ทุกคน
 *   GET  /policy/public[/files/{id}]  ไม่ต้อง login — เฉพาะเมื่อเปิดใช้และตั้งแสดงที่หน้า login
 *   GET  /policy/acceptances   ผู้ใช้ที่ใช้งานอยู่ทุกคน + วันที่ยอมรับเวอร์ชันปัจจุบัน (settings.manage)
 */
export const policyRoutes = Router();
export const publicPolicyRoutes = Router();

/** ตรงกับ DOC_* ของหน้าเว็บ (file-pickers.tsx) — ไฟล์ละ ≤ 5MB ครั้งละไม่เกิน 10 ไฟล์ */
const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
const FILES_MAX = 10;
const INLINE_MIME = /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/;

interface FileRow {
  id: number;
  original_name: string;
  path: string;
  mime: string;
  size: number;
}
const allFiles = () => select<FileRow>("SELECT * FROM policy_files ORDER BY id");
const fileJson = (f: FileRow, base = "/policy/files") => ({ id: Number(f.id), name: f.original_name, mime: f.mime, size: Number(f.size), url: `${base}/${f.id}` });

async function sendFile(res: Response, id: string, download: boolean) {
  const file = /^\d+$/.test(id) ? await first<FileRow>("SELECT * FROM policy_files WHERE id = ?", [Number(id)]) : null;
  if (!file) throw notFound();
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
  res.json({ data: { version: p.version, sections: p.sections, files: (await allFiles()).map((f) => fileJson(f, "/policy/public/files")) } });
});

publicPolicyRoutes.get("/policy/public/files/:id", async (req, res) => {
  if (!(await loginPolicy())) throw notFound();
  await sendFile(res, req.params.id, "download" in req.query);
});

/** เนื้อหาแต่ละฉบับ — keep = ไม่ทับของเดิม */
const saveVersion = (version: number, sections: PolicySection[], keep = false) =>
  exec(
    keep
      ? "INSERT IGNORE INTO policy_versions (version, sections, created_at) VALUES (?, ?, ?)"
      : "INSERT INTO policy_versions (version, sections, created_at) VALUES (?, ?, ?) AS new ON DUPLICATE KEY UPDATE sections = new.sections",
    [version, JSON.stringify(sections), nowDb()],
  );

policyRoutes.get("/policy", async (req, res) => {
  const p = await systemPolicy();
  const accepted = policyActive(p) ? await acceptanceOf(me(req).id, p.version) : null;
  res.json({ data: { ...p, files: (await allFiles()).map((f) => fileJson(f)) }, active: policyActive(p), accepted_at: accepted?.accepted_at ?? null });
});

policyRoutes.post("/policy/accept", async (req, res) => {
  const u = me(req);
  const data = await validate(req.input, { version: ["required", "integer"], user_agent: ["nullable", "string"] }, { locale: req.locale });
  const p = await systemPolicy();
  // นโยบายถูกแก้ระหว่างอ่าน (เพิ่มเวอร์ชัน) = ต้องอ่านฉบับใหม่ก่อน
  if (!policyActive(p) || Number(data.version) !== p.version) throw ValidationError.withMessages({ version: trans(req.locale, "eam.policy.version_changed") });
  const now = nowDb();
  const userAgent = String(data.user_agent ?? req.get("User-Agent") ?? "").slice(0, 255) || null;
  // ยอมรับซ้ำ (กดสองครั้ง) = คงวันเวลาครั้งแรก
  const result = await exec(
    "INSERT IGNORE INTO policy_acceptances (user_id, version, accepted_at, ip, user_agent, name_stamp) VALUES (?, ?, ?, ?, ?, ?)",
    [u.id, p.version, now, req.ip ?? null, userAgent, u.name],
  );
  if (result.rowCount) {
    await saveVersion(p.version, p.sections, true);
    await audit(req, { action: "policy.accepted", subjectType: "policy", subjectId: p.version, after: { version: p.version } });
    // ประทับลายเซ็นถ้ามีแล้ว — ยังไม่มี = เติมให้ตอนอัปโหลดลายเซ็น
    await signPolicyAcceptances(u.id, req);
  }
  res.json({ data: { version: p.version, accepted_at: (await acceptanceOf(u.id, p.version))!.accepted_at } });
});

policyRoutes.put("/policy", async (req, res) => {
  const u = me(req);
  authorize(can(u, "settings.manage"));
  const data = await validate(
    req.input,
    {
      enabled: ["sometimes", "boolean"],
      reaccept: ["sometimes", "boolean"],
      sections: ["nullable", "array", `max:${MAX_POLICY_SECTIONS}`],
      "sections.*.title": ["required", "string", "max:200"],
      "sections.*.body": ["required", "string", "max:20000"],
    },
    { locale: req.locale },
  );
  const sections: PolicySection[] = Object.values((data.sections ?? {}) as Record<string, PolicySection>).map((s) => ({
    title: String(s.title).trim(),
    body: String(s.body).replace(/\r\n/g, "\n").trim(),
  }));
  const before = await systemPolicy();
  // ไม่ส่ง enabled (หน้าจัดการเนื้อหา) = คงค่าเดิม — เปิด-ปิดอยู่ที่ PUT /policy/options
  const enabled = "enabled" in data ? bool(data.enabled) : before.enabled;
  if (enabled && !sections.length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.sections_required") });

  // ครั้งแรกที่มีเนื้อหา = เวอร์ชัน 1, ติ๊ก "ให้ทุกคนยอมรับใหม่" = เวอร์ชันถัดไป (การยอมรับเดิมไม่นับ)
  const version = sections.length && (before.version === 0 || bool(data.reaccept)) ? before.version + 1 : before.version;
  const after = { enabled, display: before.display, version, sections, updated_at: iso(nowDb()) };
  // ขึ้นฉบับใหม่: เก็บเนื้อหาฉบับเดิมไว้ให้เอกสารของคนที่ยอมรับไปแล้ว
  if (before.version > 0 && before.version !== version) await saveVersion(before.version, before.sections, true);
  await putSetting("system_policy", after, u.id);
  if (version > 0) await saveVersion(version, sections);
  await audit(req, {
    action: "settings.policy_updated",
    subjectType: "settings",
    subjectId: "system_policy",
    before: { enabled: before.enabled, version: before.version, titles: before.sections.map((s) => s.title) },
    after: { enabled, version, titles: sections.map((s) => s.title) },
  });
  res.json({ data: after });
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
  await sendFile(res, req.params.id, "download" in req.query);
});

policyRoutes.post("/policy/files", async (req, res) => {
  const u = me(req);
  authorize(can(u, "settings.manage"));
  const data = await validate(req.input, { files: ["required", "array", "min:1", `max:${FILES_MAX}`], "files.*": FILE_RULE }, { locale: req.locale });
  const uploads = Object.values(data.files as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const names = await transaction(async () => {
    const now = nowDb();
    const saved: string[] = [];
    for (const file of uploads) {
      const stored = await storeUploadIn("policy/files", file);
      await insert("policy_files", { ...stored, uploaded_by: u.id, created_at: now, updated_at: now });
      saved.push(stored.original_name);
    }
    return saved;
  });
  await audit(req, { action: "settings.policy_file_added", subjectType: "settings", subjectId: "system_policy", after: { files: names } });
  res.status(201).json({ data: (await allFiles()).map((f) => fileJson(f)) });
});

policyRoutes.delete("/policy/files/:id", async (req, res) => {
  authorize(can(me(req), "settings.manage"));
  const file = /^\d+$/.test(req.params.id) ? await first<FileRow>("SELECT * FROM policy_files WHERE id = ?", [Number(req.params.id)]) : null;
  if (!file) throw notFound();
  await exec("DELETE FROM policy_files WHERE id = ?", [file.id]);
  await deleteStored(file.path);
  await audit(req, { action: "settings.policy_file_deleted", subjectType: "settings", subjectId: "system_policy", before: { file: file.original_name } });
  res.status(204).end();
});

interface AcceptanceRow {
  version: number;
  accepted_at: string;
  ip: string | null;
  name_stamp: string | null;
  signature_path: string | null;
}
/** การยอมรับล่าสุดของผู้ใช้ */
const latestAcceptance = (userId: number) => first<AcceptanceRow>("SELECT version, accepted_at, ip, name_stamp, signature_path FROM policy_acceptances WHERE user_id = ? ORDER BY version DESC LIMIT 1", [userId]);

/** เปิดเอกสารของผู้ใช้ได้ไหม: เจ้าของ / ดูหรือจัดการผู้ใช้ได้ (ตรงกับผู้ที่เห็นคอลัมน์ในหน้าผู้ใช้) / จัดการนโยบาย */
function documentUser(req: import("express").Request): number {
  const u = me(req);
  const id = /^\d+$/.test(String(req.params.user)) ? Number(req.params.user) : NaN;
  if (Number.isNaN(id)) throw notFound();
  authorize(id === u.id || ["users.view", "users.create", "users.update", "users.delete", "settings.manage"].some((key) => can(u, key)));
  return id;
}

policyRoutes.get("/policy/documents/:user", async (req, res) => {
  const id = documentUser(req);
  const user = await first<{ id: number; name: string; email: string | null; job_title: string | null; department: string | null; branch: string | null }>(
    "SELECT u.id, u.name, u.email, u.job_title, u.department, b.name AS branch FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = ?",
    [id],
  );
  if (!user) throw notFound();
  const accepted = await latestAcceptance(id);
  const p = await systemPolicy();
  const version = accepted?.version ?? p.version;
  // เนื้อหาของฉบับที่ยอมรับ — ยังไม่มีสำเนาฉบับนั้น = ฉบับปัจจุบัน
  const snapshot = accepted ? await first<{ sections: unknown }>("SELECT sections FROM policy_versions WHERE version = ?", [accepted.version]) : null;
  const raw = snapshot ? (typeof snapshot.sections === "string" ? JSON.parse(snapshot.sections) : snapshot.sections) : p.sections;
  res.json({
    data: {
      user: { ...user, id: Number(user.id) },
      version,
      sections: raw as PolicySection[],
      accepted_at: accepted ? iso(accepted.accepted_at) : null,
      ip: accepted?.ip ?? null,
      name_stamp: accepted?.name_stamp ?? null,
      signature_url: accepted?.signature_path ? `/policy/documents/${id}/signature` : null,
    },
  });
});

policyRoutes.get("/policy/documents/:user/signature", async (req, res) => {
  const id = documentUser(req);
  const accepted = await latestAcceptance(id);
  if (!accepted?.signature_path) throw notFound();
  const stored = await readStored(accepted.signature_path);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(stored.data);
});

policyRoutes.get("/policy/acceptances", async (req, res) => {
  authorize(can(me(req), "settings.manage"));
  const p = await systemPolicy();
  const rows = await select<{ id: number; name: string; email: string | null; type: string; branch: string | null; accepted_at: string | null; ip: string | null }>(
    `SELECT u.id, u.name, u.email, u.type, b.name AS branch, a.accepted_at, a.ip
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN policy_acceptances a ON a.user_id = u.id AND a.version = ?
      WHERE u.is_active = true
      ORDER BY a.accepted_at IS NULL, a.accepted_at DESC, u.name
      LIMIT 2000`,
    [p.version],
  );
  res.json({
    data: rows.map((r) => ({ user: { id: r.id, name: r.name, email: r.email, type: r.type, branch: r.branch }, accepted_at: iso(r.accepted_at), ip: r.ip })),
    version: p.version,
    accepted: rows.filter((r) => r.accepted_at).length,
    total: rows.length,
  });
});
