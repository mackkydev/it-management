import { Router, type Request } from "express";
import { exec, first, insert, scalar, select } from "../db.js";
import { authorize, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb } from "../lib/time.js";
import { UploadedFile } from "../lib/uploaded-file.js";
import { validate, type Rule } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { putSetting } from "../services/settings.js";
import { MAX_POLICY_SECTIONS, parseSections, POLICY_MANAGE, policyFileJson, policyFilesOf, systemPolicy, type PolicyFileRow, type PolicySection } from "../services/system-policy.js";
import { deleteStored, randomString, readStored, storeUploadIn, writeStored } from "../services/ticket-files.js";

/**
 * นโยบายแต่ละฉบับ (policy.manage) — ฉบับที่แสดงให้ผู้ใช้ = app_settings.system_policy.version
 *   GET    /policy/versions                     ทุกฉบับ + จำนวนผู้ยอมรับ + ไฟล์แนบ
 *   POST   /policy/versions                     เพิ่มฉบับใหม่ { title, sections }
 *   GET    /policy/versions/{v}
 *   PUT    /policy/versions/{v}                 แก้ { title, sections } — มีผู้ยอมรับแล้ว = แก้ได้เฉพาะชื่อ
 *   POST   /policy/versions/{v}/duplicate       คัดลอกเนื้อหา + ไฟล์แนบเป็นฉบับใหม่
 *   PUT    /policy/versions/{v}/default         ตั้งเป็นฉบับที่แสดงให้ผู้ใช้
 *   DELETE /policy/versions/{v}                 ลบไม่ได้ถ้าเป็นฉบับที่แสดงอยู่ หรือมีผู้ยอมรับแล้ว
 *   POST   /policy/versions/{v}/files, DELETE /policy/versions/{v}/files/{id}  ไฟล์แนบ — มีผู้ยอมรับแล้ว = แก้ไม่ได้
 *   GET    /policy/versions/{v}/acceptances     ผู้ใช้ + วันที่ยอมรับฉบับนี้
 */
export const policyVersionRoutes = Router();

const FILE_RULE: Rule[] = ["file", "mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png", "max:5120"];
const FILES_MAX = 10;

interface VersionRow {
  version: number;
  title: string;
  sections: unknown;
  created_at: string | null;
  published_at: string | null;
  updated_at: string | null;
  creator: string | null;
  accepted: number;
}

const SELECT = `v.version, v.title, v.sections, v.created_at, v.published_at, v.updated_at, u.name AS creator,
  (SELECT COUNT(*) FROM policy_acceptances a WHERE a.version = v.version) AS accepted
  FROM policy_versions v LEFT JOIN users u ON u.id = v.created_by`;

const manage = (req: Request) => authorize(can(me(req), POLICY_MANAGE));

const json = (r: VersionRow, files: PolicyFileRow[], defaultVersion: number) => {
  const version = Number(r.version);
  const accepted = Number(r.accepted);
  return {
    version,
    title: r.title,
    sections: parseSections(r.sections),
    is_default: version === defaultVersion,
    published_at: iso(r.published_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    created_by: r.creator,
    accepted,
    /** มีผู้ยอมรับแล้ว = เนื้อหาและไฟล์แนบเป็นหลักฐาน แก้ไม่ได้ */
    locked: accepted > 0,
    files: files.filter((f) => Number(f.version) === version).map((f) => policyFileJson(f)),
  };
};

async function findRow(req: Request): Promise<VersionRow> {
  const version = /^\d+$/.test(String(req.params.version)) ? Number(req.params.version) : NaN;
  const row = Number.isNaN(version) ? null : await first<VersionRow>(`SELECT ${SELECT} WHERE v.version = ?`, [version]);
  if (!row) throw notFound();
  return row;
}

const respond = async (version: number) => {
  const row = (await first<VersionRow>(`SELECT ${SELECT} WHERE v.version = ?`, [version]))!;
  return json(row, await policyFilesOf([version]), (await systemPolicy()).version);
};

const validatedContent = async (req: Request): Promise<{ title: string; sections: PolicySection[] }> => {
  const data = await validate(
    req.input,
    {
      title: ["required", "string", "max:200"],
      sections: ["nullable", "array", `max:${MAX_POLICY_SECTIONS}`],
      "sections.*.title": ["required", "string", "max:200"],
      "sections.*.body": ["required", "string", "max:20000"],
    },
    { locale: req.locale },
  );
  return {
    title: String(data.title).trim(),
    sections: Object.values((data.sections ?? {}) as Record<string, PolicySection>).map((s) => ({
      title: String(s.title).trim(),
      body: String(s.body).replace(/\r\n/g, "\n").trim(),
    })),
  };
};

/** เลขฉบับถัดไป — นับรวมฉบับที่ถูกลบไม่ได้ เลขจึงไม่ซ้ำกับการยอมรับเดิม */
async function nextVersion(): Promise<number> {
  const [versions, accepted, current] = await Promise.all([scalar("SELECT MAX(version) FROM policy_versions"), scalar("SELECT MAX(version) FROM policy_acceptances"), systemPolicy()]);
  return Math.max(Number(versions ?? 0), Number(accepted ?? 0), current.version) + 1;
}

const insertVersion = async (version: number, title: string, sections: PolicySection[], userId: number) => {
  const now = nowDb();
  await exec("INSERT INTO policy_versions (version, title, sections, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [version, title, JSON.stringify(sections), userId, now, now]);
};

const lockedError = (req: Request, field: string) => ValidationError.withMessages({ [field]: trans(req.locale, "eam.policy.version_locked") });

policyVersionRoutes.get("/policy/versions", async (req, res) => {
  manage(req);
  const rows = await select<VersionRow>(`SELECT ${SELECT} ORDER BY v.version DESC`);
  const files = await policyFilesOf(rows.map((r) => Number(r.version)));
  const p = await systemPolicy();
  res.json({ data: rows.map((r) => json(r, files, p.version)), enabled: p.enabled, display: p.display });
});

policyVersionRoutes.post("/policy/versions", async (req, res) => {
  manage(req);
  const u = me(req);
  const { title, sections } = await validatedContent(req);
  const version = await nextVersion();
  await insertVersion(version, title, sections, u.id);
  await audit(req, { action: "policy.version_created", subjectType: "policy", subjectId: version, after: { title, titles: sections.map((s) => s.title) } });
  res.status(201).json({ data: await respond(version) });
});

policyVersionRoutes.get("/policy/versions/:version", async (req, res) => {
  manage(req);
  res.json({ data: await respond(Number((await findRow(req)).version)) });
});

policyVersionRoutes.put("/policy/versions/:version", async (req, res) => {
  manage(req);
  const row = await findRow(req);
  const version = Number(row.version);
  const { title, sections } = await validatedContent(req);
  const before = parseSections(row.sections);
  const changed = JSON.stringify(before) !== JSON.stringify(sections);
  if (changed && Number(row.accepted) > 0) throw lockedError(req, "sections");
  const p = await systemPolicy();
  const isDefault = p.version === version;
  if (isDefault && !sections.length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.sections_required") });
  await exec("UPDATE policy_versions SET title = ?, sections = ?, updated_at = ? WHERE version = ?", [title, JSON.stringify(sections), nowDb(), version]);
  // ฉบับที่แสดงอยู่: ให้ผู้ใช้เห็นเนื้อหาล่าสุด
  if (isDefault && changed) await putSetting("system_policy", { ...p, sections, updated_at: iso(nowDb()) }, me(req).id);
  await audit(req, { action: "policy.version_updated", subjectType: "policy", subjectId: version, before: { title: row.title, titles: before.map((s) => s.title) }, after: { title, titles: sections.map((s) => s.title) } });
  res.json({ data: await respond(version) });
});

policyVersionRoutes.post("/policy/versions/:version/duplicate", async (req, res) => {
  manage(req);
  const u = me(req);
  const row = await findRow(req);
  const version = await nextVersion();
  await insertVersion(version, row.title, parseSections(row.sections), u.id);
  // ไฟล์แต่ละฉบับแยกกันจริง: ลบไฟล์ของฉบับหนึ่งต้องไม่กระทบอีกฉบับ
  const now = nowDb();
  for (const f of await policyFilesOf([Number(row.version)])) {
    const stored = await readStored(f.path);
    const ext = f.path.includes(".") ? f.path.slice(f.path.lastIndexOf(".")) : "";
    const path = `policy/files/${randomString(32)}${ext}`;
    await writeStored(path, stored.data);
    await insert("policy_files", { version, original_name: f.original_name, path, mime: f.mime, size: f.size, uploaded_by: u.id, created_at: now, updated_at: now });
  }
  await audit(req, { action: "policy.version_duplicated", subjectType: "policy", subjectId: version, after: { from: Number(row.version) } });
  res.status(201).json({ data: await respond(version) });
});

policyVersionRoutes.put("/policy/versions/:version/default", async (req, res) => {
  manage(req);
  const row = await findRow(req);
  const version = Number(row.version);
  const sections = parseSections(row.sections);
  if (!sections.length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.default_required_sections") });
  const before = await systemPolicy();
  const now = nowDb();
  await exec("UPDATE policy_versions SET published_at = COALESCE(published_at, ?) WHERE version = ?", [now, version]);
  await putSetting("system_policy", { ...before, version, sections, updated_at: iso(now) }, me(req).id);
  await audit(req, { action: "policy.default_changed", subjectType: "policy", subjectId: version, before: { version: before.version }, after: { version } });
  res.json({ data: await respond(version) });
});

policyVersionRoutes.delete("/policy/versions/:version", async (req, res) => {
  manage(req);
  const row = await findRow(req);
  const version = Number(row.version);
  if ((await systemPolicy()).version === version) throw ValidationError.withMessages({ version: trans(req.locale, "eam.policy.delete_default") });
  if (Number(row.accepted) > 0) throw ValidationError.withMessages({ version: trans(req.locale, "eam.policy.delete_accepted") });
  const files = await policyFilesOf([version]);
  await exec("DELETE FROM policy_files WHERE version = ?", [version]);
  await exec("DELETE FROM policy_versions WHERE version = ?", [version]);
  for (const f of files) await deleteStored(f.path);
  await audit(req, { action: "policy.version_deleted", subjectType: "policy", subjectId: version, before: { title: row.title } });
  res.status(204).end();
});

policyVersionRoutes.post("/policy/versions/:version/files", async (req, res) => {
  manage(req);
  const u = me(req);
  const row = await findRow(req);
  const version = Number(row.version);
  if (Number(row.accepted) > 0) throw lockedError(req, "files");
  const data = await validate(req.input, { files: ["required", "array", "min:1", `max:${FILES_MAX}`], "files.*": FILE_RULE }, { locale: req.locale });
  const uploads = Object.values(data.files as Record<string, unknown>).filter((f): f is UploadedFile => f instanceof UploadedFile);
  const now = nowDb();
  const names: string[] = [];
  for (const file of uploads) {
    const stored = await storeUploadIn("policy/files", file);
    await insert("policy_files", { version, ...stored, uploaded_by: u.id, created_at: now, updated_at: now });
    names.push(stored.original_name);
  }
  await audit(req, { action: "policy.file_added", subjectType: "policy", subjectId: version, after: { files: names } });
  res.status(201).json({ data: await respond(version) });
});

policyVersionRoutes.delete("/policy/versions/:version/files/:id", async (req, res) => {
  manage(req);
  const row = await findRow(req);
  const version = Number(row.version);
  if (Number(row.accepted) > 0) throw lockedError(req, "files");
  const file = /^\d+$/.test(req.params.id) ? await first<PolicyFileRow>("SELECT * FROM policy_files WHERE id = ? AND version = ?", [Number(req.params.id), version]) : null;
  if (!file) throw notFound();
  await exec("DELETE FROM policy_files WHERE id = ?", [file.id]);
  await deleteStored(file.path);
  await audit(req, { action: "policy.file_deleted", subjectType: "policy", subjectId: version, before: { file: file.original_name } });
  res.status(204).end();
});

policyVersionRoutes.get("/policy/versions/:version/acceptances", async (req, res) => {
  manage(req);
  const row = await findRow(req);
  const version = Number(row.version);
  // ผู้ใช้ที่ใช้งานอยู่ทุกคน + คนที่เลิกใช้งานแล้วแต่เคยยอมรับฉบับนี้ (เก็บเป็นหลักฐาน)
  const rows = await select<{ id: number; name: string; email: string | null; type: string; branch: string | null; department: string | null; job_title: string | null; accepted_at: string | null; ip: string | null; name_stamp: string | null }>(
    `SELECT u.id, u.name, u.email, u.type, u.department, u.job_title, b.name AS branch, a.accepted_at, a.ip, a.name_stamp
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN policy_acceptances a ON a.user_id = u.id AND a.version = ?
      WHERE u.is_active = true OR a.id IS NOT NULL
      ORDER BY a.accepted_at IS NULL, a.accepted_at DESC, u.name
      LIMIT 5000`,
    [version],
  );
  res.json({
    data: rows.map((r) => ({
      user: { id: Number(r.id), name: r.name, email: r.email, type: r.type, branch: r.branch, department: r.department, job_title: r.job_title },
      accepted_at: iso(r.accepted_at),
      ip: r.ip,
      name_stamp: r.name_stamp,
    })),
    version,
    title: row.title,
    accepted: rows.filter((r) => r.accepted_at).length,
    total: rows.length,
  });
});
