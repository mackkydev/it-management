import { createHash } from "node:crypto";
import { exec, first, insert, lockNamed, scalar, select, transaction, update } from "../db.js";
import { localToday, nowDb } from "../lib/time.js";
import { config } from "../config.js";
import { allSettings, putSetting } from "./settings.js";
import { StecError, stecConfigured, stecReport } from "./stec-client.js";

/**
 * ซิงค์ Fixed Assets จาก STEC SyteLine API → fixed_assets (สำเนาอ่านอย่างเดียว ทางเดียว) — ดู docs/fixed-assets-sync.md
 * - ดึงรายงานค่าเสื่อม (มีทุกฟิลด์ของ Fixed Assets List) ทีละ site ตามลำดับ — ไม่ยิงพร้อมกัน ไม่กดดัน ERP
 * - upsert ตาม (site, fanum), แถวที่ไม่อยู่ในผล = missing_since (ไม่ลบ) — ยกเว้น site นั้นดึงไม่สำเร็จ / ได้ 0 แถว
 * - ผูกกับ assets อัตโนมัติด้วยเลขที่ทรัพย์สิน (asset_tag / cpu_tag / monitor_tag) — ไม่แตะแถวที่ผูก/ยกเลิกด้วยมือ (link_source = manual)
 * - ไม่เขียนทับข้อมูลใน assets
 */

export const SETTING_KEY = "fixed_asset_sync";
export const ALL_SITES = ["HO", "BR", "CB", "CR", "DP", "KK", "LP", "NR", "PB", "ST", "UB"];
/** pSite = nvarchar(8) (คู่มือ Rev 4.6 ข้อ 3.16–3.18) */
export const SITE_RE = /^[A-Z0-9]{1,8}$/;
export const PATH_RE = /^\/[A-Za-z0-9/_.-]*$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface FixedAssetSyncSettings {
  enabled: boolean;
  sites: string[];
  /** กรอง fadept — [] = ทุกแผนก */
  departments: string[];
  /** กรอง faclass (หมวดสินทรัพย์ เช่น OFFI / INTA) — [] = ทุกหมวด */
  classes: string[];
  include_inactive: boolean;
  /** เวลาไทยที่ซิงค์อัตโนมัติวันละครั้ง */
  time: string;
  paths: { depreciation: string; classdept: string };
}

export const SYNC_DEFAULTS: FixedAssetSyncSettings = {
  enabled: false,
  sites: ALL_SITES,
  departments: ["IT"],
  classes: [],
  include_inactive: false,
  time: "02:00",
  // path ตามคู่มือ STEC SyteLine API Rev 4.6 ข้อ 3.17–3.18
  paths: { depreciation: "/api/v1/reports/facurrentdepreciation", classdept: "/api/v1/reports/faclassdeptlist" },
};

export async function syncSettings(): Promise<FixedAssetSyncSettings> {
  const stored = ((await allSettings())[SETTING_KEY] ?? {}) as Partial<FixedAssetSyncSettings>;
  return { ...SYNC_DEFAULTS, ...stored, paths: { ...SYNC_DEFAULTS.paths, ...(stored.paths ?? {}) } };
}

export const saveSyncSettings = (v: FixedAssetSyncSettings, userId: number | null) => putSetting(SETTING_KEY, v, userId);

/** พร้อมซิงค์ = มีค่าใน .env + path รายงานค่าเสื่อม */
export const syncReady = (s: FixedAssetSyncSettings) => stecConfigured() && Boolean(s.paths.depreciation);

/* ---------------------------------------------------------------- แปลงแถว */

type SourceRow = Record<string, unknown>;

/** ตัวเลขค่าเสื่อมรายงวด — เปลี่ยนทุกเดือน ไม่นับเป็น "ข้อมูลเปลี่ยน" */
const VOLATILE = new Set(["deprdays", "deprperiod", "deprytd", "accumdepr", "nbv", "disposaldeprperiod", "disposaldeprytd", "disposalaccumdepr", "disposalnbv"]);

const text = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** วันที่จาก SQL Server (ISO ไม่มี timezone จริง — driver ใส่ Z) → YYYY-MM-DD */
const date = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const dateTime = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? `${v.slice(0, 10)} ${v.slice(11, 19)}` : null;

export function rowHash(row: SourceRow): string {
  const stable = Object.keys(row)
    .filter((k) => !VOLATILE.has(k))
    .sort()
    .map((k) => [k, row[k]]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

const COLUMNS = [
  "site", "fanum", "branch_id", "site_name", "description", "fa_class", "fa_dept", "fa_type", "fa_status", "fa_location",
  "acquired_on", "depr_start_on", "disposed_on", "acq_cost", "accum_depr", "nbv", "salvage", "depr_method", "depr_rate", "useful_life",
  "source_data", "row_hash", "source_recorded_at", "as_of", "first_synced_at", "synced_at", "changed_at",
] as const;

/** อัปเดตทุกคอลัมน์ยกเว้นตัวระบุ / first_synced_at — changed_at ต้องมาก่อน row_hash (MySQL ประเมินซ้ายไปขวา) */
const UPDATE_SET = [
  `changed_at = IF(fixed_assets.row_hash <> new.row_hash, new.synced_at, fixed_assets.changed_at)`,
  ...COLUMNS.filter((c) => !["site", "fanum", "first_synced_at", "changed_at"].includes(c)).map((c) => `"${c}" = new."${c}"`),
  "missing_since = NULL",
].join(", ");

function toValues(site: string, r: SourceRow, branchId: number | null, asOf: string, now: string): unknown[] {
  const v: Record<(typeof COLUMNS)[number], unknown> = {
    site,
    fanum: text(r.fanum, 50),
    branch_id: branchId,
    site_name: text(r.sitename, 255),
    description: text(r.fadesc, 500),
    fa_class: text(r.faclass, 20),
    fa_dept: text(r.fadept, 20),
    fa_type: text(r.fatype, 20),
    fa_status: text(r.fastat, 20),
    fa_location: text(r.falocation, 255),
    acquired_on: date(r.acqdate),
    depr_start_on: date(r.deprstartdate),
    disposed_on: date(r.disposaldate),
    acq_cost: num(r.acqcost),
    accum_depr: num(r.accumdepr),
    nbv: num(r.nbv),
    salvage: num(r.salvage),
    depr_method: text(r.deprmethod, 20),
    depr_rate: num(r.deprrate),
    useful_life: num(r.usefullife),
    source_data: r,
    row_hash: rowHash(r),
    source_recorded_at: dateTime(r.recorddate),
    as_of: asOf,
    first_synced_at: now,
    synced_at: now,
    changed_at: now,
  };
  return COLUMNS.map((c) => v[c]);
}

/* ---------------------------------------------------------------- ซิงค์ */

export interface SiteStats {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  classdepts?: number;
  error?: string;
}

export interface SyncResult {
  run_id: number;
  status: "ok" | "partial" | "failed";
  stats: Record<string, SiteStats>;
  linked: number;
  error: string | null;
}

export class SyncRunningError extends Error {}
export class SyncNotReadyError extends Error {}

const errorText = (e: unknown) => (e instanceof StecError ? e.message : e instanceof Error ? e.message.slice(0, 500) : "unknown");

/** ถือว่ารอบที่ค้าง running เกินนี้ตายไปแล้ว (เช่น server restart ระหว่างซิงค์) */
const STALE_MINUTES = 60;

/** จองรอบใหม่ (กันรันซ้อน) — มีรอบ running ที่ยังไม่เก่า = SyncRunningError */
export async function startRun(trigger: "schedule" | "manual", userId: number | null): Promise<number> {
  return transaction(async () => {
    await lockNamed("fixed-asset-sync");
    const running = await scalar<number>(
      `SELECT id FROM fixed_asset_sync_runs WHERE status = 'running' AND started_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${STALE_MINUTES} MINUTE) LIMIT 1`,
    );
    if (running) throw new SyncRunningError();
    await exec(
      `UPDATE fixed_asset_sync_runs SET status = 'failed', error = 'stale', finished_at = ? WHERE status = 'running'`,
      [nowDb()],
    );
    return insert("fixed_asset_sync_runs", { run_trigger: trigger, triggered_by: userId, status: "running", started_at: nowDb() });
  });
}

async function branchMap(): Promise<Map<string, number>> {
  const rows = await select<{ id: number; code: string; work_group: string | null }>("SELECT id, code, work_group FROM branches");
  const map = new Map<string, number>();
  for (const b of rows) {
    if (b.work_group) map.set(b.work_group.toUpperCase(), Number(b.id));
  }
  for (const b of rows) map.set(b.code.toUpperCase(), Number(b.id)); // รหัสสาขาตรงตัวมาก่อน
  return map;
}

async function syncSite(site: string, s: FixedAssetSyncSettings, branchId: number | null, asOf: string): Promise<SiteStats> {
  const stats: SiteStats = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, missing: 0 };
  const rows = await stecReport(s.paths.depreciation, {
    period: asOf,
    fatype: "LR",
    fastat: s.include_inactive ? "ADI" : "AD",
    pSite: site,
  });
  stats.fetched = rows.length;

  const depts = new Set(s.departments.map((d) => d.toUpperCase()));
  const classes = new Set(s.classes.map((c) => c.toUpperCase()));
  const seen = new Map<string, SourceRow>();
  for (const r of rows) {
    const fanum = text(r.fanum, 50);
    if (!fanum) continue;
    if (String(r.site ?? site).toUpperCase() !== site) continue;
    if (depts.size && !depts.has(String(r.fadept ?? "").trim().toUpperCase())) continue;
    if (classes.size && !classes.has(String(r.faclass ?? "").trim().toUpperCase())) continue;
    seen.set(fanum, r); // fanum ซ้ำในผล = ใช้แถวหลังสุด
  }

  const now = nowDb();
  await transaction(async () => {
    const existing = new Map(
      (await select<{ fanum: string; row_hash: string }>("SELECT fanum, row_hash FROM fixed_assets WHERE site = ?", [site])).map((r) => [r.fanum.toUpperCase(), r.row_hash]),
    );
    const list = [...seen.values()];
    for (const r of list) {
      const prev = existing.get(String(text(r.fanum, 50)).toUpperCase());
      if (prev === undefined) stats.inserted++;
      else if (prev !== rowHash(r)) stats.updated++;
      else stats.unchanged++;
    }
    const placeholder = `(${COLUMNS.map(() => "?").join(", ")})`;
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      await exec(
        `INSERT INTO fixed_assets (${COLUMNS.map((c) => `"${c}"`).join(", ")}) VALUES ${chunk.map(() => placeholder).join(", ")} AS new ON DUPLICATE KEY UPDATE ${UPDATE_SET}`,
        chunk.flatMap((r) => toValues(site, r, branchId, asOf, now)),
      );
    }
    // ไม่พบในผลรอบนี้ → missing — เฉพาะเมื่อผลเชื่อถือได้ (ไม่ถูกตัด และไม่ว่างทั้งที่เคยมีข้อมูล)
    // ผลเกินเพดานแถว API ตอบ 503 REPORT_LIMIT_EXCEEDED (ไม่ตัดผลเงียบๆ) จึงเหลือกรณีผลว่างทั้งที่เคยมีข้อมูล
    const trustworthy = !(rows.length === 0 && existing.size > 0);
    if (trustworthy) {
      const keep = [...seen.keys()];
      stats.missing = (
        await exec(
          `UPDATE fixed_assets SET missing_since = ? WHERE site = ? AND missing_since IS NULL${keep.length ? " AND fanum NOT IN (?)" : ""}`,
          keep.length ? [now, site, keep] : [now, site],
        )
      ).rowCount;
    } else if (rows.length === 0) {
      stats.error = "empty_result";
    }
  });

  // รหัสหมวด-แผนก — ไม่สำเร็จไม่ทำให้ site นี้ล้ม
  if (s.paths.classdept) {
    try {
      const cds = await stecReport(s.paths.classdept, { pSite: site });
      const values = cds
        .map((r) => [site, text(r.classdept, 30), text(r.deptdesc, 255), now] as const)
        .filter((v) => v[1]);
      for (let i = 0; i < values.length; i += 200) {
        const chunk = values.slice(i, i + 200);
        await exec(
          `INSERT INTO fixed_asset_classdepts (site, class_dept, description, synced_at) VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")} AS new ON DUPLICATE KEY UPDATE description = new.description, synced_at = new.synced_at`,
          chunk.flat(),
        );
      }
      stats.classdepts = values.length;
    } catch {
      stats.classdepts = -1;
    }
  }
  return stats;
}

/** ผูกอัตโนมัติ: เลขที่ทรัพย์สินตรง asset_tag → cpu_tag → monitor_tag (กติกาเดียวกับ assetIdByNumber) */
export async function autoLink(): Promise<number> {
  const match = `x.deleted_at IS NULL AND (x.asset_tag = f.fanum OR x.cpu_tag = f.fanum OR x.monitor_tag = f.fanum)`;
  return (
    await exec(
      `UPDATE fixed_assets f
          SET f.asset_id = (SELECT x.id FROM assets x WHERE ${match} ORDER BY x.asset_tag = f.fanum DESC, x.cpu_tag = f.fanum DESC, x.id LIMIT 1),
              f.link_source = 'auto'
        WHERE f.asset_id IS NULL AND f.link_source IS NULL AND EXISTS (SELECT 1 FROM assets x WHERE ${match})`,
    )
  ).rowCount;
}

/** รันการซิงค์ทั้งรอบ (รอจนเสร็จ) — runId จาก startRun() */
export async function runSync(runId: number): Promise<SyncResult> {
  const stats: Record<string, SiteStats> = {};
  let fatal: string | null = null;
  let linked = 0;
  try {
    const s = await syncSettings();
    if (!syncReady(s)) throw new SyncNotReadyError("not_configured");
    const branches = await branchMap();
    const asOf = localToday(config.localTimezone);
    for (const site of s.sites) {
      try {
        stats[site] = await syncSite(site, s, branches.get(site) ?? null, asOf);
      } catch (e) {
        stats[site] = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, missing: 0, error: errorText(e) };
        // บัญชี/การเชื่อมต่อใช้ไม่ได้ = site อื่นก็ไม่ได้ — หยุดทั้งรอบ
        if (e instanceof StecError && ["not_configured", "auth", "insecure", "blocked"].includes(e.kind)) {
          fatal = errorText(e);
          break;
        }
      }
    }
    if (!fatal) linked = await autoLink();
  } catch (e) {
    fatal = errorText(e);
  }
  const siteErrors = Object.values(stats).filter((x) => x.error).length;
  const okSites = Object.values(stats).filter((x) => !x.error).length;
  const status: SyncResult["status"] = fatal || okSites === 0 ? "failed" : siteErrors ? "partial" : "ok";
  await update("fixed_asset_sync_runs", { status, stats: { ...stats, _linked: linked }, error: fatal, finished_at: nowDb() }, "id = ?", [runId]);
  return { run_id: runId, status, stats, linked, error: fatal };
}

/** scheduler: เปิดใช้ + พร้อม + เลยเวลาที่ตั้ง (เวลาไทย) + วันนี้ยังไม่มีรอบที่เริ่มหลังเวลานั้น → ซิงค์ */
export async function syncFixedAssetsIfDue(now: Date = new Date()): Promise<SyncResult | null> {
  const s = await syncSettings();
  if (!s.enabled || !syncReady(s)) return null;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: config.localTimezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  if (hm < s.time) return null;
  const today = localToday(config.localTimezone, now);
  // ขอบเวลาที่ตั้งของวันนี้ (เวลาไทย) → UTC
  const since = await scalar<string>(`SELECT DATE_FORMAT(CONVERT_TZ(CAST(? AS DATETIME), ?, '+00:00'), '%Y-%m-%d %H:%i:%s')`, [`${today} ${s.time}:00`, tzOffset(now)]);
  const done = await first(`SELECT id FROM fixed_asset_sync_runs WHERE run_trigger = 'schedule' AND started_at >= ? LIMIT 1`, [since]);
  if (done) return null;
  let runId: number;
  try {
    runId = await startRun("schedule", null);
  } catch (e) {
    if (e instanceof SyncRunningError) return null;
    throw e;
  }
  return runSync(runId);
}

/** offset ของ timezone ผู้ใช้ เช่น "+07:00" (CONVERT_TZ ไม่ต้องพึ่งตาราง timezone ของ MySQL) */
function tzOffset(at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: config.localTimezone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part ?? "");
  return m ? m[1] : "+00:00";
}
