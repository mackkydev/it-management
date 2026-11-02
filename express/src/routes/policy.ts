import { Router } from "express";
import { exec, select } from "../db.js";
import { authorize, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, nowDb } from "../lib/time.js";
import { bool, validate } from "../lib/validator.js";
import { me } from "../http.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { putSetting } from "../services/settings.js";
import { acceptanceOf, MAX_POLICY_SECTIONS, policyActive, systemPolicy, type PolicySection } from "../services/system-policy.js";

/**
 * นโยบายของระบบ (services/system-policy.ts)
 *   GET  /policy               เนื้อหา + สถานะการยอมรับของฉัน (ทุกคน — ใช้ได้ระหว่างยังไม่ยอมรับ)
 *   POST /policy/accept        ยอมรับเวอร์ชันปัจจุบัน { version } → บันทึกวันเวลา + IP (audit policy.accepted)
 *   PUT  /policy               แก้เนื้อหา / เปิด-ปิด / ให้ทุกคนยอมรับใหม่ (settings.manage)
 *   GET  /policy/acceptances   ผู้ใช้ที่ใช้งานอยู่ทุกคน + วันที่ยอมรับเวอร์ชันปัจจุบัน (settings.manage)
 */
export const policyRoutes = Router();

policyRoutes.get("/policy", async (req, res) => {
  const p = await systemPolicy();
  const accepted = policyActive(p) ? await acceptanceOf(me(req).id, p.version) : null;
  res.json({ data: p, active: policyActive(p), accepted_at: accepted?.accepted_at ?? null });
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
    "INSERT IGNORE INTO policy_acceptances (user_id, version, accepted_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
    [u.id, p.version, now, req.ip ?? null, userAgent],
  );
  if (result.rowCount) await audit(req, { action: "policy.accepted", subjectType: "policy", subjectId: p.version, after: { version: p.version } });
  res.json({ data: { version: p.version, accepted_at: (await acceptanceOf(u.id, p.version))!.accepted_at } });
});

policyRoutes.put("/policy", async (req, res) => {
  const u = me(req);
  authorize(can(u, "settings.manage"));
  const data = await validate(
    req.input,
    {
      enabled: ["required", "boolean"],
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
  const enabled = bool(data.enabled);
  if (enabled && !sections.length) throw ValidationError.withMessages({ sections: trans(req.locale, "eam.policy.sections_required") });

  const before = await systemPolicy();
  // ครั้งแรกที่มีเนื้อหา = เวอร์ชัน 1, ติ๊ก "ให้ทุกคนยอมรับใหม่" = เวอร์ชันถัดไป (การยอมรับเดิมไม่นับ)
  const version = sections.length && (before.version === 0 || bool(data.reaccept)) ? before.version + 1 : before.version;
  const after = { enabled, version, sections, updated_at: iso(nowDb()) };
  await putSetting("system_policy", after, u.id);
  await audit(req, {
    action: "settings.policy_updated",
    subjectType: "settings",
    subjectId: "system_policy",
    before: { enabled: before.enabled, version: before.version, titles: before.sections.map((s) => s.title) },
    after: { enabled, version, titles: sections.map((s) => s.title) },
  });
  res.json({ data: after });
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
