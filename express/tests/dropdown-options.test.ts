import { describe, expect, it } from "vitest";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, makeAsset, makeUser } from "./helpers.js";

/** ข้อมูลหลัก → ข้อมูล Drop Down (Computer Type / ยี่ห้อ / หมวดหมู่คลังบัญชี) */
describe("drop-down data", () => {
  it("managers add / rename / delete; renaming follows into the records; in-use cannot be deleted", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const viewer = await as(await makeUser());
    expect((await viewer.get("/api/v1/dropdown-options/brand?include_inactive=1")).status).toBe(403);
    expect((await admin.get("/api/v1/dropdown-options/nope")).status).toBe(404);

    const dell = (await admin.post("/api/v1/dropdown-options/brand").send({ name: "Dell" })).body.data;
    expect((await admin.post("/api/v1/dropdown-options/brand").send({ name: "dell" })).status).toBe(422);
    const asset = await makeAsset({ brand: "Dell" });
    const list = (await admin.get("/api/v1/dropdown-options/brand?include_inactive=1")).body.data;
    expect(list.find((o: { id: number }) => o.id === dell.id).usage_count).toBe(1);

    const renamed = await admin.put(`/api/v1/dropdown-options/brand/${dell.id}`).send({ name: "DELL Technologies" });
    expect(renamed.body.data.name).toBe("DELL Technologies");
    expect((await first<{ brand: string }>("SELECT brand FROM assets WHERE id = ?", [asset.id]))!.brand).toBe("DELL Technologies");
    expect((await admin.delete(`/api/v1/dropdown-options/brand/${dell.id}`)).status).toBe(422);
    expect((await admin.patch(`/api/v1/dropdown-options/brand/${dell.id}`).send({ is_active: false })).body.data.is_active).toBe(false);
    expect((await viewer.get("/api/v1/dropdown-options/brand")).body.data.map((o: { name: string }) => o.name)).not.toContain("DELL Technologies");

    const hp = (await admin.post("/api/v1/dropdown-options/brand").send({ name: "HP" })).body.data;
    expect((await admin.delete(`/api/v1/dropdown-options/brand/${hp.id}`)).status).toBe(204);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'dropdown_option.%'")).toBe(5);
  });

  it("quick-add from a form needs the module's create/update permission; vault built-in names are reserved", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const staffUser = await makeUser({ is_it_staff: true }); // กลุ่ม it_staff ทดสอบ: เพิ่ม/แก้คลังบัญชีได้ + ให้เพิ่มสินทรัพย์ได้รายคน
    await admin.put(`/api/v1/users/${staffUser.id}/permissions`).send({ overrides: { "assets.create": "allow" } });
    const staff = await as(staffUser);
    const viewer = await as(await makeUser());
    expect((await staff.post("/api/v1/dropdown-options/computer_type").send({ name: "Mini PC" })).status).toBe(201);
    expect((await viewer.post("/api/v1/dropdown-options/computer_type").send({ name: "Phone" })).status).toBe(403);
    // เพิ่มด่วนแก้/ลบไม่ได้
    const row = (await staff.get("/api/v1/dropdown-options/computer_type")).body.data.find((o: { name: string }) => o.name === "Mini PC");
    expect((await staff.put(`/api/v1/dropdown-options/computer_type/${row.id}`).send({ name: "x" })).status).toBe(403);
    expect((await staff.post("/api/v1/dropdown-options/vault_category").send({ name: "Server" })).status).toBe(422);
    // หมวดตั้งต้นใหม่ (คอมพิวเตอร์ / Hosting / Hostname) — ห้ามซ้ำทั้งชื่อไทยและ key
    expect((await staff.post("/api/v1/dropdown-options/vault_category").send({ name: "คอมพิวเตอร์" })).status).toBe(422);
    expect((await staff.post("/api/v1/dropdown-options/vault_category").send({ name: "hosting" })).status).toBe(422);

    // หมวดหมู่สัญญา: หมวดตั้งต้น (builtin_key) แก้/ลบไม่ได้, เพิ่มชื่อซ้ำหมวดตั้งต้นไม่ได้
    const builtinId = await insert("contract_categories", { name: "Hostname", builtin_key: "hostname", is_active: true, sort_order: 9, created_at: nowDb(), updated_at: nowDb() });
    expect((await admin.put(`/api/v1/contract-categories/${builtinId}`).send({ name: "x" })).status).toBe(422);
    expect((await admin.delete(`/api/v1/contract-categories/${builtinId}`)).status).toBe(422);
    expect((await admin.post("/api/v1/contract-categories").send({ name: "อีเมล" })).status).toBe(422);
    expect((await admin.get("/api/v1/contract-categories")).body.data[0]).toMatchObject({ id: builtinId, key: "hostname" });
    expect((await staff.post("/api/v1/dropdown-options/vault_category").send({ name: "VPN" })).status).toBe(201);
  });
});
