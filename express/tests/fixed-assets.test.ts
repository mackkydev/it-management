import { describe, expect, it } from "vitest";
import { exec, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/**
 * Fixed Assets ระยะ 2: รายการ (แท็บ / ตัวกรอง / ตัวเลข) / รายละเอียด / ผูกด้วยมือ / ของสินทรัพย์ / ส่งออก / ตัวเลขเมนู
 * แถวใส่ตรงในตาราง (การซิงค์ทดสอบแยกที่ fixed-asset-sync.test.ts)
 */

async function fa(attrs: Record<string, unknown>) {
  const now = nowDb();
  return insert("fixed_assets", {
    site: "HO",
    site_name: "สำนักงานใหญ่",
    description: "เครื่อง",
    fa_class: "OFFI",
    fa_dept: "IT",
    fa_type: "Regular",
    fa_status: "Active",
    acq_cost: 25000,
    accum_depr: 1000,
    nbv: 24000,
    source_data: JSON.stringify({ fanum: attrs.fanum, glacctasset: "1209011" }),
    row_hash: "x".repeat(64),
    as_of: "2026-11-16",
    first_synced_at: now,
    synced_at: now,
    ...attrs,
  });
}

async function seed() {
  const branch = await makeBranch({ code: "HO", name: "สำนักงานใหญ่" });
  const pc = await makeAsset({ cpu_tag: "H-OFCO-26001", name: "PC บัญชี" });
  const sold = await makeAsset({ asset_tag: "NB-01", name: "โน้ตบุ๊กเก่า", status: "active" });
  const ids = {
    linked: await fa({ fanum: "H-OFCO-26001", branch_id: branch, asset_id: pc.id, link_source: "auto", description: "คอมพิวเตอร์ Dell" }),
    unlinked: await fa({ fanum: "H-INSW-26002", fa_class: "INTA", description: "PDF5-Business" }),
    disposedActive: await fa({ fanum: "H-OFCO-20001", fa_status: "Disposed", disposed_on: "2026-01-10", asset_id: sold.id, link_source: "manual" }),
    disposedUnlinked: await fa({ fanum: "H-OFCO-19001", fa_status: "Disposed" }),
    missing: await fa({ fanum: "B-OFCO-25001", site: "BR", missing_since: nowDb() }),
  };
  await exec("INSERT INTO fixed_asset_classdepts (site, class_dept, description, synced_at) VALUES ('HO', 'OFFI-IT', 'Information Technology', ?)", [nowDb()]);
  return { pc, sold, ids };
}

describe("fixed assets list", () => {
  it("lists by tab with counts, options and filters; requires fixed_assets.view", async () => {
    const { pc, ids } = await seed();
    const viewer = await as(await makeUser({ role: "viewer" }));
    expect((await viewer.get("/api/v1/fixed-assets")).status).toBe(403);

    const admin = await as(await makeUser({ role: "admin" }));
    const all = await admin.get("/api/v1/fixed-assets");
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(5);
    expect(all.body.meta.counts).toEqual({ unlinked: 1, disposed_active: 1, missing: 1 });
    expect(all.body.meta.options).toMatchObject({ sites: ["BR", "HO"], classes: ["INTA", "OFFI"], statuses: ["Active", "Disposed"] });
    expect(all.body.meta.can_link).toBe(true);

    const linked = all.body.data.find((r: { id: number }) => r.id === ids.linked);
    expect(linked).toMatchObject({
      fanum: "H-OFCO-26001",
      class_dept_desc: "Information Technology",
      acq_cost: 25000,
      nbv: 24000,
      branch: { name: "สำนักงานใหญ่" },
      asset: { id: pc.uuid, cpu_tag: "H-OFCO-26001", name: "PC บัญชี" },
      link_source: "auto",
    });

    const tab = async (t: string) => (await admin.get(`/api/v1/fixed-assets?tab=${t}`)).body.data.map((r: { id: number }) => r.id);
    expect(await tab("unlinked")).toEqual([ids.unlinked]);
    expect(await tab("disposed_active")).toEqual([ids.disposedActive]);
    expect(await tab("missing")).toEqual([ids.missing]);

    const search = await admin.get(`/api/v1/fixed-assets?search=${encodeURIComponent("PC บัญชี")}`);
    expect(search.body.data.map((r: { id: number }) => r.id)).toEqual([ids.linked]); // ค้นจากชื่อสินทรัพย์ที่ผูก
    const filtered = await admin.get("/api/v1/fixed-assets?fa_class=INTA&site=HO");
    expect(filtered.body.data.map((r: { id: number }) => r.id)).toEqual([ids.unlinked]);
  });

  it("menu badge = unlinked + disposed but still active, only for fixed_assets.link", async () => {
    await seed();
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.get("/api/v1/menu-badges")).body.data["/fixed-assets"]).toBe(2);
    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.get("/api/v1/menu-badges")).body.data["/fixed-assets"]).toBeUndefined();
  });

  it("detail returns the full source row", async () => {
    const { ids } = await seed();
    const admin = await as(await makeUser({ role: "admin" }));
    const r = await admin.get(`/api/v1/fixed-assets/${ids.linked}`);
    expect(r.body.data.source_data).toMatchObject({ glacctasset: "1209011" });
    expect((await admin.get("/api/v1/fixed-assets/99999")).status).toBe(404);
  });
});

describe("linking", () => {
  it("links, unlinks and resets to automatic with audit; manual stays on the next auto-link", async () => {
    const { pc, ids } = await seed();
    const other = await makeAsset({ asset_tag: "SW-PDF", name: "PDF license box" });
    const admin = await as(await makeUser({ role: "admin" }));

    const bad = await admin.put(`/api/v1/fixed-assets/${ids.unlinked}/link`).send({ asset_id: "00000000-0000-4000-8000-000000000000" });
    expect(bad.status).toBe(422);

    const linked = await admin.put(`/api/v1/fixed-assets/${ids.unlinked}/link`).send({ asset_id: other.uuid });
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ link_source: "manual", asset: { id: other.uuid } });
    expect(linked.body.data.linked_by).toBeTruthy();

    // ยกเลิกการผูกด้วยมือ → ระบบไม่ผูกกลับเอง
    const unlinked = await admin.put(`/api/v1/fixed-assets/${ids.linked}/link`).send({ asset_id: null });
    expect(unlinked.body.data).toMatchObject({ asset: null, link_source: "manual" });

    // กลับไปผูกอัตโนมัติ → ผูกตามเลขที่ทรัพย์สินทันที
    const reset = await admin.put(`/api/v1/fixed-assets/${ids.linked}/link`).send({ reset: true });
    expect(reset.body.data).toMatchObject({ link_source: "auto", asset: { id: pc.uuid } });

    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'fixed_asset.linked'")).toBe(3);

    const viewerOnly = await as(await makeUser({ role: "manager" }));
    expect((await viewerOnly.put(`/api/v1/fixed-assets/${ids.linked}/link`).send({ asset_id: null })).status).toBe(403);
  });

  it("asset options search and the asset detail card", async () => {
    const { pc, ids } = await seed();
    const admin = await as(await makeUser({ role: "admin" }));
    const opts = await admin.get("/api/v1/fixed-assets/asset-options?q=H-OFCO");
    expect(opts.body.data.map((a: { id: string }) => a.id)).toContain(pc.uuid);
    expect((await admin.get("/api/v1/fixed-assets/asset-options?q=H")).body.data).toEqual([]);

    const card = await admin.get(`/api/v1/fixed-assets/by-asset/${pc.uuid}`);
    expect(card.body.data.map((r: { id: number }) => r.id)).toEqual([ids.linked]);
    expect((await admin.get("/api/v1/fixed-assets/by-asset/not-a-uuid")).status).toBe(404);
  });

  it("exports the filtered list as Excel", async () => {
    await seed();
    const admin = await as(await makeUser({ role: "admin" }));
    const r = await admin.post("/api/v1/fixed-assets/export").send({ tab: "unlinked", headers: { sheet: "FA" } }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never);
    const ws = wb.getWorksheet("FA")!;
    expect(ws.rowCount).toBe(2); // หัว + 1 แถว (เฉพาะแท็บยังไม่ผูก)
    expect(ws.getRow(2).getCell(3).value).toBe("H-INSW-26002");
  });
});
