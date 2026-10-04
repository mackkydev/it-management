import { beforeEach, describe, expect, it } from "vitest";
import type { UserRow } from "../src/models/user.js";
import { as, day, makeAsset, makeBranch, makeUser } from "./helpers.js";

/** การติดตั้ง software license — ตรงกับ LicenseInstallationTest ของ Laravel */
let it_: UserRow;
let branch: number;

beforeEach(async () => {
  it_ = await makeUser({ name: "IT", is_it_staff: true });
  branch = await makeBranch({ code: "KKN", name: "ขอนแก่น" });
});

async function makeLicense(seats: number | null, tag = "SW-1"): Promise<string> {
  const api = await as(await makeUser({ role: "manager" }));
  const res = await api.post("/api/v1/assets").send({
    asset_tag: tag, name: `Office ${tag}`, category: "SOFTWARE",
    license: { billing: "yearly", start_date: day(0), expires_at: day(364), seats },
  });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe("license installations", () => {
  it("records installs on an asset or a typed machine and counts seats used", async () => {
    const lic = await makeLicense(2);
    const pc = await makeAsset({ asset_tag: "PC-001", name: "Notebook Dell" });
    const user = await makeUser({ name: "สมชาย" });
    const api = await as(it_, "th");

    const bad = await api.post("/api/v1/license-installations").send({ license_id: lic, installed_at: day(1) });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.device_name[0]).toBe("ระบุเครื่องที่ติดตั้ง — เลือกจากสินทรัพย์ หรือพิมพ์ชื่อเครื่อง");
    expect(bad.body.errors.installed_at).toBeDefined(); // วันในอนาคต
    const notLicense = await api.post("/api/v1/license-installations").send({ license_id: pc.uuid, device_name: "X", installed_at: day(0) });
    expect(notLicense.body.errors.license_id[0]).toBe("กรุณาเลือก license (สินทรัพย์หมวด Software ที่มีข้อมูล license)");

    const first = await api.post("/api/v1/license-installations").send({
      license_id: lic, device_asset_id: pc.uuid, device_name: "ไม่ใช้", user_id: user.id, branch_id: branch, installed_at: day(-3), notes: "ติดตั้งใหม่",
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      license: { id: lic, asset_tag: "SW-1" },
      device: { id: pc.uuid, asset_tag: "PC-001" },
      device_name: null,
      user: { id: user.id, name: "สมชาย" },
      branch: { id: branch, name: "ขอนแก่น" },
      installed_at: day(-3),
      uninstalled_at: null,
      created_by: { id: it_.id },
    });
    const second = await api.post("/api/v1/license-installations").send({ license_id: lic, device_name: "ACC-PC-07", installed_at: day(0) });
    expect(second.body.data).toMatchObject({ device: null, device_name: "ACC-PC-07" });

    // ครบจำนวน seat → บันทึกเพิ่มไม่ได้
    const full = await api.post("/api/v1/license-installations").send({ license_id: lic, device_name: "PC-3", installed_at: day(0) });
    expect(full.status).toBe(422);
    expect(full.body.errors.license_id[0]).toBe("license นี้ติดตั้งครบ 2 เครื่องแล้ว — ถอนการติดตั้งเดิม หรือเพิ่มจำนวน seat ก่อน");

    const list = await api.get(`/api/v1/license-installations?license_id=${lic}`);
    expect(list.body.usage).toEqual({ seats: 2, used: 2, available: 0 });
    expect(list.body.data.map((r: { device_name: string | null }) => r.device_name)).toEqual(["ACC-PC-07", null]);
    expect((await api.get("/api/v1/license-installations?search=dell")).body.data).toHaveLength(1);
    expect((await api.get("/api/v1/license-installations/licenses")).body.data[0]).toMatchObject({ id: lic, seats: 2, used: 2, available: 0, days_left: 364 });

    // ถอนการติดตั้ง → คืน seat (เก็บประวัติ)
    const removed = await api.post(`/api/v1/license-installations/${second.body.data.id}/uninstall`).send({});
    expect(removed.body.data.uninstalled_at).toBe(day(0));
    expect((await api.post(`/api/v1/license-installations/${second.body.data.id}/uninstall`).send({})).body.errors.uninstalled_at[0]).toBe("รายการนี้ถอนการติดตั้งไปแล้ว");
    expect((await api.get(`/api/v1/license-installations?license_id=${lic}`)).body.usage).toEqual({ seats: 2, used: 1, available: 1 });
    expect((await api.get(`/api/v1/license-installations?license_id=${lic}&status=removed`)).body.data).toHaveLength(1);
    expect((await api.get(`/api/v1/license-installations?license_id=${lic}&status=all`)).body.meta.total).toBe(2);
    expect((await api.post("/api/v1/license-installations").send({ license_id: lic, device_name: "PC-3", installed_at: day(0) })).status).toBe(201);

    // ลดจำนวน seat ต่ำกว่าที่ใช้อยู่ไม่ได้
    const manager = await as(await makeUser({ role: "manager" }), "th");
    const shrink = await manager.patch(`/api/v1/assets/${lic}`).send({ license: { billing: "yearly", start_date: day(0), expires_at: day(364), seats: 1 } });
    expect(shrink.status).toBe(422);
    expect(shrink.body.errors["license.seats"][0]).toBe("จำนวน seat ต้องไม่น้อยกว่าที่ติดตั้งใช้งานอยู่ (2 เครื่อง)");

    expect((await api.delete(`/api/v1/license-installations/${first.body.data.id}`)).status).toBe(204);
    expect((await api.get(`/api/v1/license-installations?license_id=${lic}`)).body.usage.used).toBe(1);
  });

  it("licenses without a seat limit are unlimited; access is IT or asset managers only", async () => {
    const lic = await makeLicense(null, "SW-SITE");
    const api = await as(it_);
    for (const n of [1, 2, 3]) expect((await api.post("/api/v1/license-installations").send({ license_id: lic, device_name: `PC-${n}`, installed_at: day(0) })).status).toBe(201);
    expect((await api.get(`/api/v1/license-installations?license_id=${lic}`)).body.usage).toEqual({ seats: null, used: 3, available: null });

    const viewer = await as(await makeUser());
    expect((await viewer.get("/api/v1/license-installations")).status).toBe(403);
    expect((await viewer.post("/api/v1/license-installations").send({ license_id: lic, device_name: "X", installed_at: day(0) })).status).toBe(403);
    expect((await api.get("/api/v1/users?search=")).status).toBe(200); // ฝ่าย IT ค้นหาผู้ใช้ได้ (เลือกผู้ใช้ของการติดตั้ง)
  });
});
