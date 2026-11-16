import { normalizeIp } from "../lib/client.js";
import { Router, type Response } from "express";
import { exec, first, select } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { forgetCached } from "../lib/request-cache.js";
import { iso, nowDb } from "../lib/time.js";
import { bool, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { putSetting } from "../services/settings.js";
import { signPolicyAcceptances } from "../services/signatures.js";
import {
  acceptanceOf,
  activePolicies,
  parseSections,
  POLICY_DISPLAYS,
  POLICY_MANAGE,
  POLICY_PACES,
  policyFileJson,
  policyFilesOf,
  policyProgress,
  shownPolicies,
  systemPolicy,
  type PolicyFileRow,
  type ShownPolicy,
  type SystemPolicy,
} from "../services/system-policy.js";
import { readStored } from "../services/ticket-files.js";

/**
 * นโยบายของระบบฝั่งผู้ใช้ (services/system-policy.ts) — จัดการแต่ละฉบับอยู่ที่ routes/policy-versions.ts
 *   GET  /policy               ทุกเรื่องที่แสดงอยู่ตามลำดับ (+ ฉบับก่อนหน้าของเรื่องนั้นไว้เทียบส่วนที่เปลี่ยน) + การยอมรับของฉัน
 *                              + required = ฉบับที่ต้องยอมรับตอนนี้ตามลำดับ (ทุกคน — ใช้ได้ระหว่างยังไม่ยอมรับ)
 *   POST /policy/accept        ยอมรับฉบับที่แสดงอยู่ { version } → บันทึกวันเวลา + IP (audit policy.accepted)
 *   PUT  /policy/options       เปิด-ปิด + ให้ยอมรับที่หน้า login / หลัง login + ทั้งหมดวันเดียว / วันละเรื่อง (settings.manage)
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
const loginPolicies = async (): Promise<ShownPolicy[]> => {
  const p = await systemPolicy();
  return p.display === "login" ? activePolicies(p) : [];
};

publicPolicyRoutes.get("/policy/public", async (_req, res) => {
  const items = await loginPolicies();
  if (!items.length) return res.json({ data: null });
  const files = await policyFilesOf(items.map((i) => i.version));
  res.json({
    data: {
      items: items.map((i) => ({
        version: i.version,
        title: i.title,
        sections: i.sections,
        files: files.filter((f) => Number(f.version) === i.version).map((f) => policyFileJson(f, "/policy/public/files")),
      })),
    },
  });
});

publicPolicyRoutes.get("/policy/public/files/:id", async (req, res) => {
  const items = await loginPolicies();
  if (!items.length) throw notFound();
  const file = await findFile(req.params.id);
  if (!items.some((i) => i.version === Number(file.version))) throw notFound();
  await sendFile(res, file, "download" in req.query);
});

/** ฉบับก่อนหน้าที่เคยประกาศใช้ของแต่ละเรื่อง (เลขฉบับต่ำกว่าถัดไป — ร่างไม่นับ) ไว้เทียบว่าหัวข้อไหนเปลี่ยน */
async function previousOf(items: ShownPolicy[]) {
  if (!items.length) return new Map<number, { version: number; title: string; sections: ReturnType<typeof parseSections>; published_at: string | null }>();
  const rows = await select<{ group_id: number; version: number; title: string; sections: unknown; published_at: string | null }>(
    "SELECT group_id, version, title, sections, published_at FROM policy_versions WHERE group_id IN (?) AND published_at IS NOT NULL ORDER BY version DESC",
    [items.map((i) => i.group_id)],
  );
  const result = new Map<number, { version: number; title: string; sections: ReturnType<typeof parseSections>; published_at: string | null }>();
  for (const item of items) {
    const row = rows.find((r) => Number(r.group_id) === item.group_id && Number(r.version) < item.version);
    if (row) result.set(item.version, { version: Number(row.version), title: row.title, sections: parseSections(row.sections), published_at: iso(row.published_at) });
  }
  return result;
}

policyRoutes.get("/policy", async (req, res) => {
  const p = await systemPolicy();
  const items = await shownPolicies();
  const { accepted, required } = await policyProgress(me(req).id);
  const previous = await previousOf(items);
  const files = await policyFilesOf([...items.map((i) => i.version), ...[...previous.values()].map((v) => v.version)]);
  const filesOf = (version: number) => files.filter((f) => Number(f.version) === version).map((f) => policyFileJson(f));
  res.json({
    data: {
      ...p,
      items: items.map((i) => {
        const prev = previous.get(i.version);
        return { ...i, files: filesOf(i.version), accepted_at: accepted.get(i.version) ?? null, previous: prev ? { ...prev, files: filesOf(prev.version) } : null };
      }),
    },
    active: p.enabled && items.length > 0,
    required,
  });
});

policyRoutes.post("/policy/accept", async (req, res) => {
  const u = me(req);
  const data = await validate(req.input, { version: ["required", "integer"], user_agent: ["nullable", "string"] }, { locale: req.locale });
  const version = Number(data.version);
  // นโยบายถูกแก้ระหว่างอ่าน (เปลี่ยนฉบับ / ซ่อนเรื่องนั้น) = ต้องอ่านฉบับใหม่ก่อน
  if (!(await activePolicies()).some((a) => a.version === version)) throw ValidationError.withMessages({ version: trans(req.locale, "eam.policy.version_changed") });
  const now = nowDb();
  const userAgent = String(data.user_agent ?? req.get("User-Agent") ?? "").slice(0, 255) || null;
  // ยอมรับซ้ำ (กดสองครั้ง) = คงวันเวลาครั้งแรก
  const result = await exec(
    "INSERT IGNORE INTO policy_acceptances (user_id, version, accepted_at, ip, user_agent, name_stamp) VALUES (?, ?, ?, ?, ?, ?)",
    [u.id, version, now, normalizeIp(req.ip), userAgent, u.name],
  );
  forgetCached("policy:progress:");
  if (result.rowCount) {
    await audit(req, { action: "policy.accepted", subjectType: "policy", subjectId: version, after: { version } });
    // ประทับลายเซ็นถ้ามีแล้ว — ยังไม่มี = เติมให้ตอนอัปโหลดลายเซ็น
    await signPolicyAcceptances(u.id, req);
  }
  res.json({ data: { version, accepted_at: (await acceptanceOf(u.id, version))!.accepted_at }, required: (await policyProgress(u.id)).required });
});

policyRoutes.put("/policy/options", async (req, res) => {
  const u = me(req);
  authorize(can(u, "settings.manage"));
  const data = await validate(
    req.input,
    { enabled: ["required", "boolean"], display: ["required", `in:${POLICY_DISPLAYS.join(",")}`], pace: ["nullable", `in:${POLICY_PACES.join(",")}`] },
    { locale: req.locale },
  );
  const before = await systemPolicy();
  const enabled = bool(data.enabled);
  if (enabled && !(await shownPolicies()).length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.sections_required") });
  const after: SystemPolicy = { enabled, display: data.display as SystemPolicy["display"], pace: (data.pace as SystemPolicy["pace"] | null) ?? before.pace };
  await putSetting("system_policy", after, u.id);
  forgetCached("policy:");
  await audit(req, { action: "settings.policy_options", subjectType: "settings", subjectId: "system_policy", before, after });
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
  // ยังไม่เคยยอมรับ = เรื่องแรกที่แสดงอยู่
  const version = accepted?.version ?? asked ?? (await shownPolicies())[0]?.version ?? 0;
  const snapshot = await first<{ title: string; sections: unknown }>("SELECT title, sections FROM policy_versions WHERE version = ?", [version]);
  res.json({
    data: {
      user: { ...user, id: Number(user.id) },
      version: Number(version),
      title: snapshot?.title ?? "",
      sections: snapshot ? parseSections(snapshot.sections) : [],
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
