import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec, first, scalar, select } from "../src/db.js";
import {
  autoLink,
  runSync,
  saveSyncSettings,
  sourceCodes,
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
 *   GET  <paths.info>?pSite&fastat → { recordsets: [[row...]] }  (ข้อ 3.27 Fixed assets info — API เดียวที่เรียก)
 */

// path ตามคู่มือ STEC SyteLine API ข้อ 3.27 Fixed assets info
const INFO = "/api/v1/reports/fainfo";
const PASSWORD = "svc-pass";

type Call = { method: string; path: string; query: Record<string, string>; auth?: string };
let calls: Call[] = [];
let reports: Record<string, Record<string, unknown>[] | number> = {};
let tokenSeq = 0;
let revoked = new Set<string>();

const row = (site: string, fanum: string, extra: Record<string, unknown> = {}) => ({
  site,
  sitename: site === "HO" ? "สำนักงานใหญ่" : `สาขา ${site}`,
  fanum,
  fadesc: `เครื่อง ${fanum}`,
  faclass: "OFFI",
  fadept: "IT",
  fastat: "Active",
  enduser: "ส่วนกลาง",
  serial: null,
  mfg: "16007-CO4401",
  recorddate: "2025-02-09T14:08:53.280Z",
  ...extra,
});

const settings = (over: Partial<FixedAssetSyncSettings> = {}): FixedAssetSyncSettings => ({
  ...SYNC_DEFAULTS,
  sites: ["HO", "BR"],
  departments: ["IT"],
  paths: { info: INFO },
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
      if (url.pathname === INFO) {
        const r = reports[query.pSite];
        if (typeof r === "number") return reply(r, { error: { code: "REPORT_LIMIT_EXCEEDED", requestId: "req-123" } });
        return reply(200, { recordsets: [r ?? []] });
      }
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
    expect(r.stats.HO).toMatchObject({ fetched: 3, inserted: 2, updated: 0, missing: 0 });
    expect(r.stats.BR).toMatchObject({ fetched: 1, inserted: 1 });
    expect(r.linked).toBe(1);

    // แผนก HM ไม่อยู่ในขอบเขต
    expect(await fa("H-VEHI-01001")).toBeNull();
    const a = await fa("H-OFCO-26001");
    expect(a).toMatchObject({ site: "HO", fa_class: "OFFI", fa_dept: "IT", fa_status: "Active", acquired_on: null, acq_cost: null, link_source: "auto", missing_since: null });
    expect(Number(a!.branch_id)).toBe(ho);
    expect(Number(a!.asset_id)).toBe(asset.id);
    expect(typeof a!.source_data === "string" ? JSON.parse(a!.source_data) : a!.source_data).toMatchObject({ enduser: "ส่วนกลาง", mfg: "16007-CO4401" });
    expect(a!.source_recorded_at).toBe("2025-02-09 14:08:53");
    expect((await fa("B-OFCO-25001"))!.branch_id).toBeNull(); // ไม่มีสาขารหัส BR

    // query ตามที่ portal ส่ง
    const info = calls.find((c) => c.path === INFO && c.query.pSite === "HO")!;
    expect(info.query).toEqual({ pSite: "HO", fastat: "AD" });
    // เรียก API เดียว (+ login)
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set(["/api/v1/auth/login", INFO]));
    expect(calls.filter((c) => c.path === "/api/v1/auth/login")).toHaveLength(1); // token ใช้ซ้ำ

    const run = await first<{ status: string; finished_at: string | null }>("SELECT status, finished_at FROM fixed_asset_sync_runs WHERE id = ?", [r.run_id]);
    expect(run).toMatchObject({ status: "ok" });
    expect(run!.finished_at).not.toBeNull();
  });

  it("remembers department and class codes seen at the source, before filtering", async () => {
    await saveSyncSettings(settings(), null);
    expect(await sourceCodes()).toBeNull();
    await sync();
    // HM / VEHI ถูกกรองออก แต่ยังเป็นตัวเลือกได้; นับทุกสาขาที่ดึงสำเร็จ
    expect(await sourceCodes()).toMatchObject({ departments: { HM: 1, IT: 3 }, classes: { INTA: 1, OFFI: 2, VEHI: 1 } });

    // ไม่สำเร็จเลย = คงชุดเดิม
    reports = { HO: 503, BR: 503 };
    await sync();
    expect((await sourceCodes())!.departments).toEqual({ HM: 1, IT: 3 });

    const api = await as(await makeUser({ role: "super_admin" }));
    expect((await api.get("/api/v1/fixed-assets/settings")).body.data.source_codes.classes).toEqual({ INTA: 1, OFFI: 2, VEHI: 1 });
  });

  it("filters by asset class when classes are selected", async () => {
    await saveSyncSettings(settings({ classes: ["INTA"], departments: [] }), null);
    const r = await sync();
    expect(r.stats.HO).toMatchObject({ fetched: 3, inserted: 1 });
    expect((await select<{ fanum: string }>("SELECT fanum FROM fixed_assets ORDER BY fanum")).map((x) => x.fanum)).toEqual(["H-INSW-26002"]);
  });

  it("detects changes, marks missing rows and clears them when they return", async () => {
    await saveSyncSettings(settings({ sites: ["HO"] }), null);
    await sync();

    reports.HO = [row("HO", "H-OFCO-26001"), row("HO", "H-INSW-26002", { faclass: "INTA", fastat: "Disposed" })];
    const r2 = await sync();
    expect(r2.stats.HO).toMatchObject({ fetched: 2, inserted: 0, updated: 1, unchanged: 1, missing: 0 });
    expect(await fa("H-INSW-26002")).toMatchObject({ fa_status: "Disposed" });

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

    const bad = await api.put("/api/v1/fixed-assets/settings").send({ sites: ["HO!"], classes: ["OF FI"], time: "25:00", paths: { info: "reports" } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["classes", "paths.info", "sites", "time"]);

    const ok = await api.put("/api/v1/fixed-assets/settings").send({ enabled: true, sites: ["ho", "BR", "HO"], departments: ["it"], classes: ["offi", "INTA"], time: "02:30", paths: { info: INFO } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ enabled: true, sites: ["HO", "BR"], departments: ["IT"], classes: ["OFFI", "INTA"], time: "02:30", ready: true });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'settings.fixed_asset_sync'")).toBe(1);
  });

  it("link button: number → asset number, Manufacturer → old asset number, unique matches only", async () => {
    reports = {
      HO: [
        row("HO", "H-OFCO-26001", { mfg: "OLD-1" }), // เลขที่ทรัพย์สินตรง (มาก่อนเลขเดิม)
        row("HO", "H-OFCO-26002", { mfg: "OLD-2" }), // Manufacturer ตรงเลขเดิม
        row("HO", "H-OFCO-26003", { mfg: "OLD-3" }), // เลขเดิมตรง 2 เครื่อง = ข้าม
        row("HO", "H-OFCO-26004", { mfg: null }), // ไม่ตรงอะไร
      ],
    };
    await saveSyncSettings(settings({ sites: ["HO"], enabled: false }), null);
    // ซิงค์ก่อนมีสินทรัพย์ = ยังไม่ผูก
    await sync();
    expect(await scalar("SELECT COUNT(asset_id) FROM fixed_assets")).toBe(0);

    const pc1 = await makeAsset({ cpu_tag: "H-OFCO-26001", monitor_tag: "OLD-2" });
    const pc2 = await makeAsset({ cpu_tag: "X-1", monitor_tag: "OLD-2X" });
    await makeAsset({ monitor_tag: "OLD-3" });
    await makeAsset({ monitor_tag: "OLD-3" });

    const viewer = await as(await makeUser({ role: "viewer" }));
    expect((await viewer.get("/api/v1/fixed-assets/auto-link")).status).toBe(403);

    const admin = await as(await makeUser({ role: "admin" }));
    const preview = await admin.get("/api/v1/fixed-assets/auto-link");
    expect(preview.body.data).toEqual({ total: 2, by_rule: { number: 1, old_number: 1 }, conflicts: 1, linked: 0, manual: 0 });
    expect(await scalar("SELECT COUNT(asset_id) FROM fixed_assets")).toBe(0); // GET ไม่เขียน

    const done = await admin.post("/api/v1/fixed-assets/auto-link");
    expect(done.body.data).toEqual({ total: 2, by_rule: { number: 1, old_number: 1 }, conflicts: 1 });
    expect(Number((await fa("H-OFCO-26001"))!.asset_id)).toBe(pc1.id);
    expect(Number((await fa("H-OFCO-26002"))!.asset_id)).toBe(pc1.id); // 1 เครื่องผูกได้หลายรายการ
    expect((await fa("H-OFCO-26003"))!.asset_id).toBeNull();
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'fixed_assets.auto_linked'")).toBe(1);
    expect(pc2.id).toBeGreaterThan(0);

    // กดซ้ำ = ไม่มีอะไรเพิ่ม
    expect((await admin.post("/api/v1/fixed-assets/auto-link")).body.data.total).toBe(0);

    // ยกเลิกการผูกทั้งหมด (รวมที่ผูกด้วยมือ) → ผูกใหม่ได้
    await exec("UPDATE fixed_assets SET asset_id = ?, link_source = 'manual' WHERE fanum = 'H-OFCO-26004'", [pc2.id]);
    expect((await admin.get("/api/v1/fixed-assets/auto-link")).body.data).toMatchObject({ linked: 3, manual: 1 });
    expect((await viewer.delete("/api/v1/fixed-assets/links")).status).toBe(403);
    expect((await admin.delete("/api/v1/fixed-assets/links")).body.data).toEqual({ unlinked: 3 });
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets WHERE asset_id IS NOT NULL OR link_source IS NOT NULL")).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets")).toBe(4); // ไม่ลบข้อมูล
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'fixed_assets.unlinked_all'")).toBe(1);
    expect((await admin.post("/api/v1/fixed-assets/auto-link")).body.data.total).toBe(2);
  });

  it("clears synced data (unlinked only, or everything) so it can be synced again", async () => {
    await makeAsset({ cpu_tag: "H-OFCO-26001" });
    await saveSyncSettings(settings(), null);
    await sync();
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets")).toBe(3);

    const viewer = await as(await makeUser({ role: "viewer" }));
    expect((await viewer.delete("/api/v1/fixed-assets")).status).toBe(403);

    const admin = await as(await makeUser({ role: "super_admin" }));
    expect((await admin.get("/api/v1/fixed-assets/settings")).body.data.synced).toEqual({ total: 3, linked: 1 });

    // กำลังซิงค์ = ลบไม่ได้
    const runId = await startRun("manual", null);
    expect((await admin.delete("/api/v1/fixed-assets?scope=all")).status).toBe(409);
    await exec("UPDATE fixed_asset_sync_runs SET status = 'ok' WHERE id = ?", [runId]);

    const unlinked = await admin.delete("/api/v1/fixed-assets");
    expect(unlinked.body.data).toEqual({ scope: "unlinked", deleted: 2 });
    expect((await select<{ fanum: string }>("SELECT fanum FROM fixed_assets")).map((x) => x.fanum)).toEqual(["H-OFCO-26001"]);

    const all = await admin.delete("/api/v1/fixed-assets?scope=all");
    expect(all.body.data).toEqual({ scope: "all", deleted: 1 });
    expect(await scalar("SELECT COUNT(*) FROM fixed_assets")).toBe(0);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'fixed_assets.cleared'")).toBe(2);
    expect(await scalar("SELECT COUNT(*) FROM assets")).toBe(1); // สินทรัพย์ในระบบไม่ถูกแตะ

    // ซิงค์ใหม่ได้ + record date
    await sync();
    const r = await admin.get("/api/v1/fixed-assets?search=H-OFCO-26001");
    expect(r.body.data[0]).toMatchObject({ record_date: "2025-02-09", asset: { cpu_tag: "H-OFCO-26001" } });
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
    expect(runs.body.meta).toMatchObject({ current_page: 1, last_page: 1, total: 2 });

    // ประวัติแบ่งหน้าละ 10 รอบ
    for (let i = 0; i < 10; i++) await exec("INSERT INTO fixed_asset_sync_runs (run_trigger, status, started_at) VALUES ('schedule', 'ok', UTC_TIMESTAMP())");
    const p1 = await admin.get("/api/v1/fixed-assets/sync-runs");
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.meta).toMatchObject({ current_page: 1, last_page: 2, total: 12, from: 1, to: 10 });
    const p2 = await admin.get("/api/v1/fixed-assets/sync-runs?page=2");
    expect(p2.body.data.map((x: { id: number }) => x.id)).toContain(id);
    expect(p2.body.meta).toMatchObject({ current_page: 2, from: 11, to: 12 });
    // admin ไม่มี settings.manage
    expect((await admin.get("/api/v1/fixed-assets/settings")).status).toBe(403);
  });
});
