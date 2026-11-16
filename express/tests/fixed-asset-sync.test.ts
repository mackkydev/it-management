import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec, first, scalar, select } from "../src/db.js";
import {
  autoLink,
  runSync,
  saveSyncSettings,
  startRun,
  SYNC_DEFAULTS,
  syncFixedAssetsIfDue,
  SyncRunningError,
  type FixedAssetSyncSettings,
} from "../src/services/fixed-asset-sync.js";
import { resetStecSession } from "../src/services/stec-client.js";
import { setUpstreamTestHooks, type UpstreamHttpRequest } from "../src/services/upstream-http.js";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/**
 * ซิงค์ Fixed Assets จาก STEC SyteLine API (upstream จำลอง — ห้ามออกเน็ต)
 *   POST /api/v1/auth/login → { token, expiresAt }
 *   GET  <paths.depreciation>?period&fatype&fastat&pSite → { recordsets: [[row...]] }
 *   GET  <paths.classdept>?pSite                          → { recordsets: [[{ classdept, deptdesc }]] }
 */

// path ตามคู่มือ STEC SyteLine API Rev 4.6 ข้อ 3.17–3.18
const DEP = "/api/v1/reports/facurrentdepreciation";
const CD = "/api/v1/reports/faclassdeptlist";
const PASSWORD = "svc-pass";

type Call = { method: string; path: string; query: Record<string, string>; auth?: string };
let calls: Call[] = [];
let reports: Record<string, Record<string, unknown>[] | number> = {};
let tokenSeq = 0;
let revoked = new Set<string>();

const row = (site: string, fanum: string, extra: Record<string, unknown> = {}) => ({
  site,
  sitename: site === "HO" ? "สำนักงานใหญ่" : `สาขา ${site}`,
  faclass: "OFFI",
  fadept: "IT",
  fatype: "Regular",
  fanum,
  fadesc: `เครื่อง ${fanum}`,
  acqdate: "2024-04-12T00:00:00.000Z",
  deprstartdate: "2024-04-12T00:00:00.000Z",
  acqcost: 25000,
  accumdepr: 1000,
  nbv: 24000,
  salvage: 1,
  deprperiod: 100,
  deprytd: 800,
  deprmethod: "SLDAYS",
  deprrate: 20,
  usefullife: 5,
  disposaldate: null,
  falocation: null,
  fastat: "Active",
  recorddate: "2025-02-09T14:08:53.280Z",
  ...extra,
});

const settings = (over: Partial<FixedAssetSyncSettings> = {}): FixedAssetSyncSettings => ({
  ...SYNC_DEFAULTS,
  sites: ["HO", "BR"],
  departments: ["IT"],
  paths: { depreciation: DEP, classdept: CD },
  ...over,
});

const sync = async () => runSync(await startRun("manual", null));
const fa = (fanum: string) => first<Record<string, unknown>>("SELECT * FROM fixed_assets WHERE fanum = ?", [fanum]);

beforeEach(() => {
  process.env.STEC_API_BASE_URL = "https://stec.example.com";
  process.env.STEC_API_USERNAME = "it-system";
  process.env.STEC_API_PASSWORD = PASSWORD;
  process.env.STEC_API_ALLOWED_HOSTS = "";
  resetStecSession();
  calls = [];
  tokenSeq = 0;
  revoked = new Set();
  reports = { HO: [row("HO", "H-OFCO-26001"), row("HO", "H-INSW-26002", { faclass: "INTA" }), row("HO", "H-VEHI-01001", { fadept: "HM", faclass: "VEHI" })], BR: [row("BR", "B-OFCO-25001")] };
  setUpstreamTestHooks({
    resolve: async () => ["93.184.216.34"],
    transport: async (req: UpstreamHttpRequest) => {
      const url = new URL(req.url);
      const query = Object.fromEntries(url.searchParams);
      calls.push({ method: req.method, path: url.pathname, query, auth: req.headers.Authorization });
      const reply = (status: number, body?: unknown) => ({ status, headers: {}, body: body === undefined ? "" : JSON.stringify(body) });
      const tok = req.headers.Authorization?.replace("Bearer ", "");
      const authed = tok && tok.startsWith("tok-") && !revoked.has(tok);
      if (req.method === "POST" && url.pathname === "/api/v1/auth/login") {
        const b = JSON.parse(req.body ?? "{}");
        if (b.username !== "it-system" || b.password !== PASSWORD) return reply(401, {});
        return reply(200, { token: `tok-${++tokenSeq}`, tokenType: "Bearer", expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
      }
      if (url.pathname === "/health") return reply(200, { status: "ok" });
      if (!authed) return reply(401, {});
      if (url.pathname === "/api/v1/auth/permissions") return reply(200, { appIds: [41, 42], loadedAt: "", cacheExpiresAt: "" });
      if (url.pathname === DEP) {
        const r = reports[query.pSite];
        if (typeof r === "number") return reply(r, { error: { code: "REPORT_LIMIT_EXCEEDED", requestId: "req-123" } });
        return reply(200, { recordsets: [r ?? []] });
      }
      if (url.pathname === CD) return reply(200, { recordsets: [[{ site: query.pSite, sitename: "", classdept: "OFFI-IT", deptdesc: "Information Technology" }]] });
      return reply(404);
    },
  });
});

afterEach(() => {
  setUpstreamTestHooks(null);
  resetStecSession();
  for (const k of ["STEC_API_BASE_URL", "STEC_API_USERNAME", "STEC_API_PASSWORD", "STEC_API_ALLOWED_HOSTS"]) delete process.env[k];
});

describe("fixed asset sync", () => {
  it("imports rows of the selected departments, maps branches and links assets by number", async () => {
    const ho = await makeBranch({ code: "HO" });
    const asset = await makeAsset({ cpu_tag: "H-OFCO-26001" });
    await saveSyncSettings(settings(), null);

    const r = await sync();
    expect(r.status).toBe("ok");
    expect(r.stats.HO).toMatchObject({ fetched: 3, inserted: 2, updated: 0, missing: 0, classdepts: 1 });
    expect(r.stats.BR).toMatchObject({ fetched: 1, inserted: 1 });
    expect(r.linked).toBe(1);

    // แผนก HM ไม่อยู่ในขอบเขต
    expect(await fa("H-VEHI-01001")).toBeNull();
    const a = await fa("H-OFCO-26001");
    expect(a).toMatchObject({ site: "HO", fa_class: "OFFI", fa_dept: "IT", fa_status: "Active", acquired_on: "2024-04-12", link_source: "auto", missing_since: null });
    expect(Number(a!.branch_id)).toBe(ho);
    expect(Number(a!.asset_id)).toBe(asset.id);
    expect(Number(a!.acq_cost)).toBe(25000);
    expect(a!.source_recorded_at).toBe("2025-02-09 14:08:53");
    expect((await fa("B-OFCO-25001"))!.branch_id).toBeNull(); // ไม่มีสาขารหัส BR

    // query ตามที่ portal ส่ง
    const dep = calls.find((c) => c.path === DEP && c.query.pSite === "HO")!;
    expect(dep.query).toMatchObject({ fatype: "LR", fastat: "AD" });
    expect(dep.query.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls.filter((c) => c.path === "/api/v1/auth/login")).toHaveLength(1); // token ใช้ซ้ำ
    expect(await scalar("SELECT COUNT(*) FROM fixed_asset_classdepts")).toBe(2);

    const run = await first<{ status: string; finished_at: string | null }>("SELECT status, finished_at FROM fixed_asset_sync_runs WHERE id = ?", [r.run_id]);
    expect(run).toMatchObject({ status: "ok" });
    expect(run!.finished_at).not.toBeNull();
  });

  it("filters by asset class when classes are selected", async () => {
    await saveSyncSettings(settings({ classes: ["INTA"], departments: [] }), null);
    const r = await sync();
    expect(r.stats.HO).toMatchObject({ fetched: 3, inserted: 1 });
    expect((await select<{ fanum: string }>("SELECT fanum FROM fixed_assets ORDER BY fanum")).map((x) => x.fanum)).toEqual(["H-INSW-26002"]);
  });

  it("detects changes, ignores monthly depreciation, marks missing rows and clears them when they return", async () => {
    await saveSyncSettings(settings({ sites: ["HO"] }), null);
    await sync();

    // ค่าเสื่อมรายงวดเปลี่ยน = ไม่นับเป็นข้อมูลเปลี่ยน แต่ตัวเลขอัปเดต
    reports.HO = [row("HO", "H-OFCO-26001", { accumdepr: 2000, nbv: 23000 }), row("HO", "H-INSW-26002", { faclass: "INTA", fastat: "Disposed", disposaldate: "2026-10-01T00:00:00.000Z" })];
    const r2 = await sync();
    expect(r2.stats.HO).toMatchObject({ fetched: 2, inserted: 0, updated: 1, unchanged: 1, missing: 0 });
    expect(Number((await fa("H-OFCO-26001"))!.nbv)).toBe(23000);
    expect(await fa("H-INSW-26002")).toMatchObject({ fa_status: "Disposed", disposed_on: "2026-10-01" });

    // หายจากต้นทาง → missing (ไม่ลบ) → กลับมา = ล้าง
    reports.HO = [row("HO", "H-OFCO-26001")];
    const r3 = await sync();
    expect(r3.stats.HO.missing).toBe(1);
    expect((await fa("H-INSW-26002"))!.missing_since).not.toBeNull();
    reports.HO = [row("HO", "H-OFCO-26001"), row("HO", "H-INSW-26002", { faclass: "INTA" })];
    await sync();
    expect((await fa("H-INSW-26002"))!.missing_since).toBeNull();
  });

  it("does not mark rows missing when a site fails (e.g. row cap exceeded) or returns nothing", async () => {
    await saveSyncSettings(settings(), null);
    await sync();

    // เกินเพดานแถว = API ตอบ 503 REPORT_LIMIT_EXCEEDED (คู่มือ Rev 4.6 ข้อ 3.2) — เก็บ code + requestId ไว้แจ้ง STEC
    reports.HO = 503;
    const failed = await sync();
    expect(failed.status).toBe("partial");
    expect(failed.stats.HO.error).toBe("stec unavailable (503 REPORT_LIMIT_EXCEEDED) requestId=req-123");
    expect(failed.stats.BR.error).toBeUndefined();
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets WHERE missing_since IS NOT NULL")).toBe(0);

    reports.HO = [];
    const empty = await sync();
    expect(empty.stats.HO).toMatchObject({ fetched: 0, missing: 0, error: "empty_result" });
    expect(empty.status).toBe("partial");
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets WHERE missing_since IS NOT NULL")).toBe(0);
  });

  it("logs in again once when the token is rejected, and fails the whole run on bad credentials", async () => {
    await saveSyncSettings(settings({ sites: ["HO"] }), null);
    await sync();
    revoked.add("tok-1");
    const r = await sync();
    expect(r.status).toBe("ok");
    expect(calls.filter((c) => c.path === "/api/v1/auth/login")).toHaveLength(2);

    resetStecSession();
    process.env.STEC_API_PASSWORD = "wrong";
    await saveSyncSettings(settings(), null);
    const bad = await sync();
    expect(bad.status).toBe("failed");
    expect(bad.error).toContain("auth");
    expect(bad.stats.BR).toBeUndefined(); // หยุดทั้งรอบ ไม่ลองสาขาถัดไป
  });

  it("keeps manual links and manual unlinks", async () => {
    const a1 = await makeAsset({ asset_tag: "H-OFCO-26001" });
    await makeAsset({ cpu_tag: "H-INSW-26002" });
    await saveSyncSettings(settings({ sites: ["HO"] }), null);
    await sync();
    const other = await makeAsset();
    await exec("UPDATE fixed_assets SET asset_id = ?, link_source = 'manual' WHERE fanum = 'H-OFCO-26001'", [other.id]);
    await exec("UPDATE fixed_assets SET asset_id = NULL, link_source = 'manual' WHERE fanum = 'H-INSW-26002'");
    expect(await autoLink()).toBe(0);
    await sync();
    expect(Number((await fa("H-OFCO-26001"))!.asset_id)).toBe(other.id);
    expect((await fa("H-INSW-26002"))!.asset_id).toBeNull();
    expect(a1.id).not.toBe(other.id);
  });

  it("refuses overlapping runs", async () => {
    await saveSyncSettings(settings(), null);
    await startRun("manual", null);
    await expect(startRun("schedule", null)).rejects.toBeInstanceOf(SyncRunningError);
    // รอบที่ค้างเกิน 60 นาที = ถือว่าตายแล้ว
    await exec("UPDATE fixed_asset_sync_runs SET started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)");
    await expect(startRun("schedule", null)).resolves.toBeGreaterThan(0);
    expect(await scalar("SELECT COUNT(*) FROM fixed_asset_sync_runs WHERE status = 'failed' AND error = 'stale'")).toBe(1);
  });

  it("scheduler runs once a day after the set time, only when enabled and configured", async () => {
    await saveSyncSettings(settings({ enabled: false, time: "00:00" }), null);
    expect(await syncFixedAssetsIfDue()).toBeNull();
    await saveSyncSettings(settings({ enabled: true, time: "00:00" }), null);
    const r = await syncFixedAssetsIfDue();
    expect(r?.status).toBe("ok");
    expect(await syncFixedAssetsIfDue()).toBeNull();
    delete process.env.STEC_API_PASSWORD;
    await exec("DELETE FROM fixed_asset_sync_runs");
    expect(await syncFixedAssetsIfDue()).toBeNull();
  });
});

describe("fixed asset routes", () => {
  it("settings: validates, saves with audit and never returns the password", async () => {
    const admin = await makeUser({ role: "super_admin" });
    const api = await as(admin);
    const g = await api.get("/api/v1/fixed-assets/settings");
    expect(g.status).toBe(200);
    expect(g.body.data.connection).toEqual({ configured: true, host: "stec.example.com", username: "it-system", has_password: true });
    expect(JSON.stringify(g.body)).not.toContain(PASSWORD);

    const bad = await api.put("/api/v1/fixed-assets/settings").send({ sites: ["HO!"], classes: ["OF FI"], time: "25:00", paths: { depreciation: "reports" } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["classes", "paths.depreciation", "sites", "time"]);

    const ok = await api.put("/api/v1/fixed-assets/settings").send({ enabled: true, sites: ["ho", "BR", "HO"], departments: ["it"], classes: ["offi", "INTA"], time: "02:30", paths: { depreciation: DEP, classdept: "" } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ enabled: true, sites: ["HO", "BR"], departments: ["IT"], classes: ["OFFI", "INTA"], time: "02:30", ready: true });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'settings.fixed_asset_sync'")).toBe(1);
  });

  it("test connection reports login and appIds", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const r = await api.post("/api/v1/fixed-assets/test");
    expect(r.body.data).toEqual({ health: true, login: true, app_ids: [41, 42], error: null, status: null });
  });

  it("sync endpoint: permission, not configured, 202 then 409 while running, history", async () => {
    const viewer = await as(await makeUser({ role: "viewer" }));
    expect((await viewer.post("/api/v1/fixed-assets/sync")).status).toBe(403);
    expect((await viewer.get("/api/v1/fixed-assets/sync-runs")).status).toBe(403);

    const admin = await as(await makeUser({ role: "admin" }));
    delete process.env.STEC_API_PASSWORD; // .env ยังไม่ครบ
    expect((await admin.post("/api/v1/fixed-assets/sync")).status).toBe(422);
    process.env.STEC_API_PASSWORD = PASSWORD;
    await saveSyncSettings(settings({ sites: ["HO"] }), null);
    await startRun("manual", null); // มีรอบที่กำลังรันอยู่
    expect((await admin.post("/api/v1/fixed-assets/sync")).status).toBe(409);
    await exec("UPDATE fixed_asset_sync_runs SET status = 'ok'");

    const started = await admin.post("/api/v1/fixed-assets/sync");
    expect(started.status).toBe(202);
    const id = started.body.data.run_id;
    for (let i = 0; i < 100 && (await scalar("SELECT status FROM fixed_asset_sync_runs WHERE id = ?", [id])) === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const runs = await admin.get("/api/v1/fixed-assets/sync-runs");
    expect(runs.status).toBe(200);
    expect(runs.body.data[0]).toMatchObject({ id, trigger: "manual", status: "ok" });
    expect(runs.body.data[0].stats.HO).toMatchObject({ inserted: 2 });
    // admin ไม่มี settings.manage
    expect((await admin.get("/api/v1/fixed-assets/settings")).status).toBe(403);
  });
});
