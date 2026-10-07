import { describe, expect, it } from "vitest";
import { insert, scalar, select } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeUser } from "./helpers.js";

async function makeLicense(name: string, seats: number | null) {
  const a = await makeAsset({ name, category: "SOFTWARE" });
  const now = nowDb();
  await insert("asset_licenses", { asset_id: a.id, billing: "perpetual", start_date: "2026-01-01", seats, created_at: now, updated_at: now });
  return a;
}

const active = (deviceId: number) =>
  select<{ license_asset_id: number; slot: string | null }>(
    "SELECT license_asset_id, slot FROM license_installations WHERE device_asset_id = ? AND uninstalled_at IS NULL ORDER BY id",
    [deviceId],
  );

describe("computer software from licenses", () => {
  it("OS / Office / Anti Virus / others are picked from licenses and recorded as installations on the machine", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const win = await makeLicense("Windows 11 Pro", 10);
    const office = await makeLicense("Office 2021", 10);
    const av = await makeLicense("BitDefender", null);
    const zip = await makeLicense("WinRAR", 5);

    const options = (await api.get("/api/v1/assets/software-options")).body.data;
    expect(options.map((o: { name: string }) => o.name)).toEqual(["BitDefender", "Office 2021", "Windows 11 Pro", "WinRAR"]); // เรียงตาม collation ของ MySQL

    const created = await api.post("/api/v1/assets").send({
      asset_tag: "PC-SW-1", name: "Desktop", category: "COMPUTER", os: "ignored text",
      software: { os: win.uuid, office: office.uuid, antivirus: av.uuid, others: [zip.uuid] },
    });
    expect(created.status).toBe(201);
    const pc = created.body.data;
    expect(pc).toMatchObject({ os: "Windows 11 Pro", office: "Office 2021", antivirus: "BitDefender" });
    expect(pc.software).toMatchObject({ os: { id: win.uuid }, office: { id: office.uuid }, antivirus: { id: av.uuid }, others: [{ id: zip.uuid, name: "WinRAR" }] });

    const pcId = Number(await scalar("SELECT id FROM assets WHERE uuid = ?", [pc.id]));
    expect(await active(pcId)).toHaveLength(4);
    // seat ของ license ถูกนับ
    const usage = (await api.get("/api/v1/assets/software-options")).body.data.find((o: { name: string }) => o.name === "Windows 11 Pro");
    expect(usage).toMatchObject({ seats: 10, used: 1, available: 9 });

    // เอา Office + WinRAR ออก, Anti Virus ไม่ผูก (คงข้อความเดิม) → ถอนการติดตั้ง (เก็บประวัติ)
    const edited = await api.patch(`/api/v1/assets/${pc.id}`).send({ antivirus: "Kaspersky (old)", software: { os: win.uuid, others: [] } });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ os: "Windows 11 Pro", antivirus: "Kaspersky (old)", software: { os: { id: win.uuid }, office: null, antivirus: null, others: [] } });
    expect(await active(pcId)).toEqual([expect.objectContaining({ slot: "os" })]);
    expect(Number(await scalar("SELECT COUNT(*) FROM license_installations WHERE device_asset_id = ? AND uninstalled_at IS NOT NULL", [pcId]))).toBe(3);

    // ไม่ส่ง software = ไม่แตะการติดตั้ง
    await api.patch(`/api/v1/assets/${pc.id}`).send({ name: "Desktop 2" });
    expect(await active(pcId)).toHaveLength(1);
  });

  it("a full license is rejected on its field and nothing is saved", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const one = await makeLicense("Visio", 1);
    expect((await api.post("/api/v1/assets").send({ asset_tag: "PC-SW-2", name: "A", category: "COMPUTER", software: { others: [one.uuid] } })).status).toBe(201);

    const res = await api.post("/api/v1/assets").send({ asset_tag: "PC-SW-3", name: "B", category: "COMPUTER", software: { others: [one.uuid] } });
    expect(res.status).toBe(422);
    expect(res.body.errors["software.others"][0]).toContain("Visio");
    expect(await scalar("SELECT COUNT(*) FROM assets WHERE asset_tag = ?", ["PC-SW-3"])).toBe(0);

    // ไม่ใช่ license
    const pc = await makeAsset({ category: "COMPUTER" });
    const bad = await api.post("/api/v1/assets").send({ asset_tag: "PC-SW-4", name: "C", category: "COMPUTER", software: { os: pc.uuid } });
    expect(bad.body.errors).toHaveProperty(["software.os"]);
  });

  it("software options need asset management permission", async () => {
    expect((await (await as(await makeUser())).get("/api/v1/assets/software-options")).status).toBe(403);
  });
});
