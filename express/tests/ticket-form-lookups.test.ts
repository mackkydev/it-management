import { describe, expect, it } from "vitest";
import { insert } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeUser } from "./helpers.js";

async function accessTicket(requesterId: number, th: string | null, en: string | null) {
  const now = nowDb();
  await insert("it_tickets", {
    uuid: crypto.randomUUID(), ticket_no: `FM-ITR-01-2026-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`, type: "grant_access", status: "completed",
    requester_id: requesterId, details: "-", person_name_th: th, person_name_en: en, requested_at: now, created_at: now, updated_at: now,
  });
}

describe("ticket form lookups", () => {
  it("asset number lookup: matches asset_tag / asset no. / old asset no., null when not found", async () => {
    const api = await as(await makeUser());
    await makeAsset({ asset_tag: "HOST-01", cpu_tag: "FA-100", monitor_tag: "OLD-9", name: "Desktop", brand: "Dell", model: "OptiPlex" });

    for (const no of ["HOST-01", "FA-100", "OLD-9", " fa-100 "]) {
      const res = await api.get(`/api/v1/tickets/asset-lookup?no=${encodeURIComponent(no)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ asset_tag: "HOST-01", cpu_tag: "FA-100", name: "Desktop", brand: "Dell", model: "OptiPlex" });
    }
    expect((await api.get("/api/v1/tickets/asset-lookup?no=NOPE-1")).body.data).toBeNull();
    expect((await api.get("/api/v1/tickets/asset-lookup")).body.data).toBeNull();
  });

  it("asset search: partial match on asset number / asset no. / old no. / name, at least 2 characters", async () => {
    const api = await as(await makeUser());
    await makeAsset({ asset_tag: "H-OFCO-17021", cpu_tag: "FA-2001", monitor_tag: "OLD-77", name: "Desktop", brand: "Dell", model: "OptiPlex" });
    await makeAsset({ asset_tag: "H-OFCO-17022", name: "Notebook" });
    await makeAsset({ asset_tag: "H-GONE-1", name: "Gone", deleted_at: "2026-01-01 00:00:00" });
    const tags = async (q: string) =>
      (await api.get(`/api/v1/tickets/asset-search?q=${encodeURIComponent(q)}`)).body.data.map((a: { asset_tag: string }) => a.asset_tag);

    expect(await tags("ofco-170")).toEqual(["H-OFCO-17021", "H-OFCO-17022"]);
    expect(await tags("FA-20")).toEqual(["H-OFCO-17021"]);
    expect(await tags("OLD-7")).toEqual(["H-OFCO-17021"]);
    expect(await tags("noteb")).toEqual(["H-OFCO-17022"]);
    expect(await tags("H-GONE")).toEqual([]);
    expect(await tags("H")).toEqual([]);
    const [first] = (await api.get("/api/v1/tickets/asset-search?q=17021")).body.data;
    expect(first).toEqual({ asset_tag: "H-OFCO-17021", cpu_tag: "FA-2001", name: "Desktop", brand: "Dell", model: "OptiPlex" });
  });

  it("person names: pairs from earlier access tickets + active users, matching either Thai or English", async () => {
    const requester = await makeUser();
    const api = await as(requester);
    await accessTicket(requester.id, "สมชาย ใจดี", "Somchai Jaidee");
    await makeUser({ name: "สมหญิง รักงาน" });
    await makeUser({ name: "Somsak Wong" });
    await makeUser({ name: "สมปอง ปิดใช้งาน", is_active: false });

    const th = (await api.get(`/api/v1/tickets/person-names?q=${encodeURIComponent("สม")}`)).body.data;
    expect(th).toContainEqual({ th: "สมชาย ใจดี", en: "Somchai Jaidee" });
    expect(th).toContainEqual({ th: "สมหญิง รักงาน", en: "" });
    expect(th.some((p: { th: string }) => p.th === "สมปอง ปิดใช้งาน")).toBe(false);

    const en = (await api.get("/api/v1/tickets/person-names?q=som")).body.data;
    expect(en).toContainEqual({ th: "สมชาย ใจดี", en: "Somchai Jaidee" });
    expect(en).toContainEqual({ th: "", en: "Somsak Wong" }); // ชื่อไม่มีอักษรไทย = ช่องอังกฤษ

    expect((await api.get("/api/v1/tickets/person-names?q=")).body.data).toEqual([]);
  });
});

describe("ticket form: my assets include the branch's shared machines", () => {
  it("lists assets I hold first, then shared machines of my branch only", async () => {
    const { makeBranch } = await import("./helpers.js");
    const mine = await makeBranch();
    const other = await makeBranch();
    const me = await makeUser({ branch_id: mine });
    await makeAsset({ asset_tag: "MY-01", name: "โน้ตบุ๊กของฉัน", custodian_id: me.id, branch_id: mine });
    await makeAsset({ asset_tag: "SHARED-01", name: "เครื่องพิมพ์ส่วนกลาง", is_shared: true, branch_id: mine, user_name: "ส่วนกลาง" });
    await makeAsset({ asset_tag: "SHARED-99", name: "ส่วนกลางสาขาอื่น", is_shared: true, branch_id: other, user_name: "ส่วนกลาง" });
    await makeAsset({ asset_tag: "SHARED-OLD", name: "ส่วนกลางที่จำหน่ายแล้ว", is_shared: true, branch_id: mine, status: "disposed" });

    const list = (await (await as(me)).get("/api/v1/tickets/form-options")).body.data.my_assets;
    expect(list.map((a: { asset_tag: string; is_shared: boolean }) => [a.asset_tag, a.is_shared])).toEqual([
      ["MY-01", false],
      ["SHARED-01", true],
    ]);
    // ไม่มีสาขา = ไม่เห็นเครื่องส่วนกลาง
    const noBranch = await makeUser();
    expect((await (await as(noBranch)).get("/api/v1/tickets/form-options")).body.data.my_assets).toEqual([]);
  });
});
