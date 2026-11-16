import ExcelJS from "exceljs";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { first, isUuid, likeEscape, scalar, select, update } from "../db.js";
import { me, pageParam, shortMeta } from "../http.js";
import { authorize, HttpError, notFound, ValidationError } from "../lib/errors.js";
import { trans } from "../lib/i18n.js";
import { iso, localToday, nowDb } from "../lib/time.js";
import { bool } from "../lib/validator.js";
import { can } from "../models/user.js";
import { audit } from "../services/audit.js";
import { FA_FROM, FA_TABS, faCount, type FaTab } from "../services/fixed-assets.js";
import {
  autoLink,
  PATH_RE,
  runSync,
  saveSyncSettings,
  SITE_RE,
  startRun,
  syncReady,
  syncSettings,
  SyncRunningError,
  TIME_RE,
  type FixedAssetSyncSettings,
} from "../services/fixed-asset-sync.js";
import { stecPublicInfo, stecTest } from "../services/stec-client.js";

/**
 * Fixed Assets จาก STEC SyteLine — docs/fixed-assets-sync.md
 * ระยะ 1: ตั้งค่า + ทดสอบ = settings.manage, ซิงค์ = fixed_assets.sync, ประวัติ = อย่างใดอย่างหนึ่ง
 * ระยะ 2: รายการ / รายละเอียด / ส่งออก / ของสินทรัพย์ = fixed_assets.view, ผูก-ยกเลิกผูก = fixed_assets.link
 * ความลับ (รหัสผ่าน / token) อยู่ใน .env ของ API เท่านั้น — endpoint นี้ไม่ส่งออก
 */
export const fixedAssetRoutes = Router();

const settingsGuard = (req: Request) => authorize(can(me(req), "settings.manage"));
const syncGuard = (req: Request) => authorize(can(me(req), "fixed_assets.sync"));

const codeList = (v: unknown, re: RegExp, max: number): string[] | null => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const list = [...new Set(raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  if (list.length > max || list.some((x) => !re.test(x))) return null;
  return list;
};
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;

async function settingsJson() {
  const s = await syncSettings();
  return { data: { ...s, ready: syncReady(s), connection: stecPublicInfo() } };
}

fixedAssetRoutes.get("/fixed-assets/settings", async (req, res) => {
  settingsGuard(req);
  res.json(await settingsJson());
});

fixedAssetRoutes.put("/fixed-assets/settings", async (req, res) => {
  settingsGuard(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const before = await syncSettings();
  const t = (k: string) => trans(req.locale, k);
  const errors: Record<string, string> = {};

  const sites = codeList(b.sites, SITE_RE, 50);
  if (!sites || sites.length === 0) errors.sites = t("eam.fixed_asset.site_invalid");
  const departments = codeList(b.departments ?? [], CODE_RE, 100);
  if (!departments) errors.departments = t("eam.fixed_asset.code_invalid");
  const classes = codeList(b.classes ?? [], CODE_RE, 100);
  if (!classes) errors.classes = t("eam.fixed_asset.code_invalid");
  const time = typeof b.time === "string" ? b.time.trim() : before.time;
  if (!TIME_RE.test(time)) errors.time = t("eam.fixed_asset.time_invalid");
  const paths = (b.paths ?? {}) as Record<string, unknown>;
  const path = (k: "depreciation" | "classdept") => {
    const v = paths[k] === undefined ? before.paths[k] : String(paths[k] ?? "").trim();
    if (v && (!PATH_RE.test(v) || v.length > 255)) errors[`paths.${k}`] = t("eam.fixed_asset.path_invalid");
    return v;
  };
  const depreciation = path("depreciation");
  const classdept = path("classdept");
  if (Object.keys(errors).length) throw ValidationError.withMessages(errors);

  const next: FixedAssetSyncSettings = {
    enabled: b.enabled === undefined ? before.enabled : bool(b.enabled),
    sites: sites!,
    departments: departments!,
    classes: classes!,
    include_inactive: b.include_inactive === undefined ? before.include_inactive : bool(b.include_inactive),
    time,
    paths: { depreciation, classdept },
  };
  await saveSyncSettings(next, me(req).id);
  await audit(req, { action: "settings.fixed_asset_sync", subjectType: "app_settings", subjectId: "fixed_asset_sync", before, after: next });
  res.json(await settingsJson());
});

/** ทดสอบการเชื่อมต่อ: /health → login → appIds (ไม่ดึงรายงาน) */
fixedAssetRoutes.post("/fixed-assets/test", async (req, res) => {
  settingsGuard(req);
  res.json({ data: await stecTest() });
});

/** ซิงค์ตอนนี้ — ทำงานเบื้องหลัง ตอบ 202 + run_id ทันที (ดูผลที่ GET /fixed-assets/sync-runs) */
fixedAssetRoutes.post("/fixed-assets/sync", async (req, res) => {
  syncGuard(req);
  const s = await syncSettings();
  if (!syncReady(s)) throw ValidationError.withMessages({ sync: trans(req.locale, "eam.fixed_asset.not_configured") });
  let runId: number;
  try {
    runId = await startRun("manual", me(req).id);
  } catch (e) {
    if (e instanceof SyncRunningError) throw new HttpError(409, trans(req.locale, "eam.fixed_asset.running"));
    throw e;
  }
  await audit(req, { action: "fixed_assets.sync_started", subjectType: "fixed_asset_sync_runs", subjectId: runId });
  void runSync(runId).catch((e) => console.error("[fixed-assets] sync failed", e));
  res.status(202).json({ data: { run_id: runId } });
});

fixedAssetRoutes.get("/fixed-assets/sync-runs", async (req, res) => {
  authorize(can(me(req), "fixed_assets.sync") || can(me(req), "settings.manage"));
  const rows = await select<{
    id: number;
    run_trigger: string;
    status: string;
    stats: Record<string, unknown> | null;
    error: string | null;
    started_at: string;
    finished_at: string | null;
    by_name: string | null;
  }>(
    `SELECT r.id, r.run_trigger, r.status, r.stats, r.error, r.started_at, r.finished_at, u.name AS by_name
       FROM fixed_asset_sync_runs r LEFT JOIN users u ON u.id = r.triggered_by
      ORDER BY r.id DESC LIMIT 20`,
  );
  res.json({
    data: rows.map((r) => ({
      id: Number(r.id),
      trigger: r.run_trigger,
      status: r.status,
      stats: r.stats,
      error: r.error,
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      triggered_by: r.by_name,
    })),
  });
});

/* ================================================================ ระยะ 2: รายการ / ผูกกับสินทรัพย์ */

const viewGuard = (req: Request) => authorize(can(me(req), "fixed_assets.view"));
const PER_PAGE = 50;

interface FaRow {
  id: number;
  site: string;
  site_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  fanum: string;
  description: string | null;
  fa_class: string | null;
  fa_dept: string | null;
  class_dept_desc: string | null;
  fa_type: string | null;
  fa_status: string | null;
  fa_location: string | null;
  acquired_on: string | null;
  depr_start_on: string | null;
  disposed_on: string | null;
  acq_cost: string | null;
  accum_depr: string | null;
  nbv: string | null;
  salvage: string | null;
  depr_method: string | null;
  depr_rate: string | null;
  useful_life: number | null;
  as_of: string;
  missing_since: string | null;
  first_synced_at: string;
  synced_at: string;
  changed_at: string | null;
  link_source: string | null;
  asset_uuid: string | null;
  asset_tag: string | null;
  asset_cpu_tag: string | null;
  asset_name: string | null;
  asset_status: string | null;
  linked_by_name: string | null;
}

const SELECT = `f.id, f.site, f.site_name, f.branch_id, b.name AS branch_name, f.fanum, f.description, f.fa_class, f.fa_dept, cd.description AS class_dept_desc,
  f.fa_type, f.fa_status, f.fa_location, f.acquired_on, f.depr_start_on, f.disposed_on, f.acq_cost, f.accum_depr, f.nbv, f.salvage,
  f.depr_method, f.depr_rate, f.useful_life, f.as_of, f.missing_since, f.first_synced_at, f.synced_at, f.changed_at, f.link_source,
  a.uuid AS asset_uuid, a.asset_tag, a.cpu_tag AS asset_cpu_tag, a.name AS asset_name, a.status AS asset_status, lu.name AS linked_by_name`;
const FROM = `${FA_FROM} LEFT JOIN users lu ON lu.id = f.linked_by`;

const money = (v: string | number | null) => (v === null ? null : Number(v));
const faJson = (r: FaRow) => ({
  id: Number(r.id),
  site: r.site,
  site_name: r.site_name,
  branch: r.branch_id ? { id: Number(r.branch_id), name: r.branch_name } : null,
  fanum: r.fanum,
  description: r.description,
  fa_class: r.fa_class,
  fa_dept: r.fa_dept,
  class_dept_desc: r.class_dept_desc,
  fa_type: r.fa_type,
  fa_status: r.fa_status,
  fa_location: r.fa_location,
  acquired_on: r.acquired_on,
  depr_start_on: r.depr_start_on,
  disposed_on: r.disposed_on,
  acq_cost: money(r.acq_cost),
  accum_depr: money(r.accum_depr),
  nbv: money(r.nbv),
  salvage: money(r.salvage),
  depr_method: r.depr_method,
  depr_rate: money(r.depr_rate),
  useful_life: r.useful_life === null ? null : Number(r.useful_life),
  as_of: r.as_of,
  missing_since: iso(r.missing_since),
  first_synced_at: iso(r.first_synced_at),
  synced_at: iso(r.synced_at),
  changed_at: iso(r.changed_at),
  link_source: r.link_source,
  linked_by: r.linked_by_name,
  asset: r.asset_uuid ? { id: r.asset_uuid, asset_tag: r.asset_tag, cpu_tag: r.asset_cpu_tag, name: r.asset_name, status: r.asset_status } : null,
});

const param = (src: Record<string, unknown>, k: string, max = 100) => (typeof src[k] === "string" ? String(src[k]).trim().slice(0, max) : "");

/** ตัวกรองแถวเดียว (หน้ารายการ + ส่งออก): tab / search / site / fa_class / fa_dept / status */
function filters(src: Record<string, unknown>): { tab: FaTab; where: string[]; params: unknown[] } {
  const tab = (Object.keys(FA_TABS) as FaTab[]).find((k) => k === src.tab) ?? "all";
  const where: string[] = [FA_TABS[tab]];
  const params: unknown[] = [];
  const search = param(src, "search");
  if (search) {
    // ทุกคำต้องพบ — เลขที่ / ชื่อ / ที่ตั้ง / รหัส-ชื่อสินทรัพย์ที่ผูก
    for (const word of search.split(/\s+/).slice(0, 5)) {
      const like = `%${likeEscape(word)}%`;
      where.push("(f.fanum LIKE ? OR f.description LIKE ? OR f.fa_location LIKE ? OR a.asset_tag LIKE ? OR a.cpu_tag LIKE ? OR a.name LIKE ?)");
      params.push(like, like, like, like, like, like);
    }
  }
  for (const [k, col] of [["site", "f.site"], ["fa_class", "f.fa_class"], ["fa_dept", "f.fa_dept"], ["status", "f.fa_status"]] as const) {
    const v = param(src, k, 30);
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  return { tab, where, params };
}

fixedAssetRoutes.get("/fixed-assets", async (req, res) => {
  viewGuard(req);
  const { where, params } = filters(req.query as Record<string, unknown>);
  const page = pageParam(req);
  const cond = where.join(" AND ");
  const [total, rows, options, lastRun, unlinked, disposedActive, missing] = await Promise.all([
    scalar<number>(`SELECT COUNT(*) FROM ${FROM} WHERE ${cond}`, params),
    select<FaRow>(`SELECT ${SELECT} FROM ${FROM} WHERE ${cond} ORDER BY f.site, f.fanum LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params),
    select<{ k: string; v: string }>(
      `SELECT DISTINCT 'site' AS k, site AS v FROM fixed_assets
       UNION SELECT DISTINCT 'fa_class', fa_class FROM fixed_assets WHERE fa_class IS NOT NULL
       UNION SELECT DISTINCT 'fa_dept', fa_dept FROM fixed_assets WHERE fa_dept IS NOT NULL
       UNION SELECT DISTINCT 'status', fa_status FROM fixed_assets WHERE fa_status IS NOT NULL`,
    ),
    first<{ status: string; finished_at: string | null; started_at: string }>(
      "SELECT status, started_at, finished_at FROM fixed_asset_sync_runs WHERE status <> 'running' ORDER BY id DESC LIMIT 1",
    ),
    faCount("unlinked"),
    faCount("disposed_active"),
    faCount("missing"),
  ]);
  const opt = (k: string) => options.filter((o) => o.k === k).map((o) => o.v).sort();
  res.json({
    data: rows.map(faJson),
    meta: {
      ...shortMeta(Number(total ?? 0), page, PER_PAGE, rows.length),
      counts: { unlinked, disposed_active: disposedActive, missing },
      options: { sites: opt("site"), classes: opt("fa_class"), departments: opt("fa_dept"), statuses: opt("status") },
      last_sync: lastRun ? { status: lastRun.status, started_at: iso(lastRun.started_at), finished_at: iso(lastRun.finished_at) } : null,
      can_link: can(me(req), "fixed_assets.link"),
    },
  });
});

/** ส่งออก Excel ตามตัวกรองเดียวกับหน้ารายการ (ใน body) — หัวคอลัมน์แปลที่หน้าเว็บส่งมาใน body.headers (เหมือน audit-logs/export) */
fixedAssetRoutes.post("/fixed-assets/export", async (req, res) => {
  viewGuard(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const head = (body.headers && typeof body.headers === "object" ? body.headers : {}) as Record<string, unknown>;
  const h = (k: string, fallback: string) => (typeof head[k] === "string" ? String(head[k]).slice(0, 100) : fallback);
  const { where, params } = filters(body);
  const rows = await select<FaRow>(`SELECT ${SELECT} FROM ${FROM} WHERE ${where.join(" AND ")} ORDER BY f.site, f.fanum LIMIT 50000`, params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(h("sheet", "Fixed assets"));
  ws.columns = [
    { header: "Site", key: "site", width: 8 },
    { header: h("branch", "Branch"), key: "branch", width: 18 },
    { header: h("fanum", "Asset no."), key: "fanum", width: 16 },
    { header: h("description", "Description"), key: "description", width: 40 },
    { header: h("class", "Class"), key: "fa_class", width: 8 },
    { header: h("dept", "Dept"), key: "fa_dept", width: 8 },
    { header: h("status", "Status"), key: "fa_status", width: 10 },
    { header: h("acquired", "Acquired"), key: "acquired_on", width: 12 },
    { header: h("cost", "Cost"), key: "acq_cost", width: 14 },
    { header: h("accum", "Accumulated depreciation"), key: "accum_depr", width: 16 },
    { header: h("nbv", "Net book value"), key: "nbv", width: 14 },
    { header: h("disposed", "Disposed"), key: "disposed_on", width: 12 },
    { header: h("location", "Location"), key: "fa_location", width: 20 },
    { header: h("asset", "Linked asset"), key: "asset", width: 30 },
    { header: h("asOf", "As of"), key: "as_of", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows.map(faJson)) {
    ws.addRow({ ...r, branch: r.branch?.name ?? "", asset: r.asset ? `${r.asset.cpu_tag || r.asset.asset_tag} ${r.asset.name ?? ""}`.trim() : "" });
  }
  for (const k of ["acq_cost", "accum_depr", "nbv"]) ws.getColumn(k).numFmt = "#,##0.00";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="fixed-assets-${localToday(config.localTimezone)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/** ตัวเลือกสินทรัพย์ตอนผูก — เลขที่/รหัส/ชื่อ ≥ 2 ตัว (≤ 10) */
fixedAssetRoutes.get("/fixed-assets/asset-options", async (req, res) => {
  authorize(can(me(req), "fixed_assets.link"));
  const q = param(req.query as Record<string, unknown>, "q", 50);
  if (q.length < 2) return void res.json({ data: [] });
  const like = `%${likeEscape(q)}%`;
  const prefix = `${likeEscape(q)}%`;
  const rows = await select<{ uuid: string; asset_tag: string; cpu_tag: string | null; name: string; status: string }>(
    `SELECT uuid, asset_tag, cpu_tag, name, status FROM assets
      WHERE deleted_at IS NULL AND (asset_tag LIKE ? OR cpu_tag LIKE ? OR monitor_tag LIKE ? OR name LIKE ?)
      ORDER BY (asset_tag LIKE ? OR cpu_tag LIKE ?) DESC, asset_tag LIMIT 10`,
    [like, like, like, like, prefix, prefix],
  );
  res.json({ data: rows.map((r) => ({ id: r.uuid, asset_tag: r.asset_tag, cpu_tag: r.cpu_tag, name: r.name, status: r.status })) });
});

/** Fixed Assets ที่ผูกกับสินทรัพย์นี้ — การ์ด "ข้อมูลบัญชีจาก SyteLine" ในหน้ารายละเอียดสินทรัพย์ */
fixedAssetRoutes.get("/fixed-assets/by-asset/:uuid", async (req, res) => {
  viewGuard(req);
  const uuid = String(req.params.uuid);
  if (!isUuid(uuid)) throw notFound();
  const rows = await select<FaRow>(`SELECT ${SELECT} FROM ${FROM} WHERE a.uuid = ? ORDER BY f.site, f.fanum`, [uuid]);
  res.json({ data: rows.map(faJson) });
});

const findFa = async (req: Request) => {
  const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
  const row = Number.isNaN(id) ? null : await first<FaRow & { source_data: unknown }>(`SELECT ${SELECT}, f.source_data FROM ${FROM} WHERE f.id = ?`, [id]);
  if (!row) throw notFound();
  return row;
};

fixedAssetRoutes.get("/fixed-assets/:id", async (req, res) => {
  viewGuard(req);
  const row = await findFa(req);
  res.json({ data: { ...faJson(row), source_data: row.source_data } });
});

/**
 * ผูก / เปลี่ยน / ยกเลิกการผูก: { asset_id: uuid | null } → link_source = manual (การซิงค์ไม่เปลี่ยนอีก)
 * { reset: true } = กลับไปให้ระบบผูกอัตโนมัติ (ล้างแล้วผูกตามเลขที่ทรัพย์สินทันที)
 */
fixedAssetRoutes.put("/fixed-assets/:id/link", async (req, res) => {
  authorize(can(me(req), "fixed_assets.link"));
  const row = await findFa(req);
  const b = (req.body ?? {}) as { asset_id?: unknown; reset?: unknown };
  const before = { asset_id: row.asset_uuid, link_source: row.link_source };
  if (bool(b.reset)) {
    await update("fixed_assets", { asset_id: null, link_source: null, linked_by: null }, "id = ?", [row.id]);
    await autoLink();
  } else {
    let assetId: number | null = null;
    if (b.asset_id !== null && b.asset_id !== undefined && b.asset_id !== "") {
      const uuid = String(b.asset_id);
      assetId = isUuid(uuid) ? await scalar<number>("SELECT id FROM assets WHERE uuid = ? AND deleted_at IS NULL", [uuid]) : null;
      if (!assetId) throw ValidationError.withMessages({ asset_id: trans(req.locale, "eam.fixed_asset.asset_not_found") });
    }
    await update("fixed_assets", { asset_id: assetId, link_source: "manual", linked_by: me(req).id }, "id = ?", [row.id]);
  }
  const after = await findFa(req);
  await audit(req, {
    action: "fixed_asset.linked",
    subjectType: "fixed_assets",
    subjectId: row.id,
    before,
    after: { fanum: row.fanum, asset_id: after.asset_uuid, link_source: after.link_source, at: nowDb() },
  });
  res.json({ data: faJson(after) });
});
