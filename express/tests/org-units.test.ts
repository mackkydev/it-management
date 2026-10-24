import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import type { UserRow } from "../src/models/user.js";
import { as, fakeImage, guest, makeUser } from "./helpers.js";

/** แผนก/ฝ่าย (ข้อมูลหลัก), บทบาทใหม่, โลโก้ระบบ, สิทธิ์ของกลุ่ม */
describe("departments / divisions", () => {
  it("anyone can list active ones; only org.manage can manage; renames follow into users", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    const viewer = await as(await makeUser());
    expect((await viewer.post("/api/v1/departments").send({ name: "บัญชี" })).status).toBe(403);

    const created = await admin.post("/api/v1/departments").send({ name: "บัญชี" });
    expect(created.status).toBe(201);
    expect((await admin.post("/api/v1/departments").send({ name: " บัญชี " })).body.errors.name[0]).toBe("ชื่อนี้มีอยู่แล้ว");
    await admin.post("/api/v1/departments").send({ name: "ปิดไว้", is_active: false });
    expect((await viewer.get("/api/v1/departments")).body.data.map((d: { name: string }) => d.name)).toEqual(["บัญชี"]);
    expect((await viewer.get("/api/v1/departments?include_inactive=1")).status).toBe(403);

    const person = await makeUser({ department: "บัญชี" });
    const renamed = await admin.patch(`/api/v1/departments/${created.body.data.id}`).send({ name: "บัญชีและการเงิน" });
    expect(renamed.body.data.name).toBe("บัญชีและการเงิน");
    expect((await first<UserRow>("SELECT * FROM users WHERE id = ?", [person.id]))!.department).toBe("บัญชีและการเงิน");

    const list = (await admin.get("/api/v1/departments?include_inactive=1")).body.data;
    expect(list.find((d: { name: string }) => d.name === "บัญชีและการเงิน").users_count).toBe(1);
    expect((await admin.delete(`/api/v1/departments/${created.body.data.id}`)).status).toBe(422);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'department.%'")).toBe(3);
  });

  it("divisions work the same way", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const d = await admin.post("/api/v1/divisions").send({ name: "ฝ่ายขาย" });
    expect(d.status).toBe(201);
    expect((await admin.delete(`/api/v1/divisions/${d.body.data.id}`)).status).toBe(204);
  });

  it("a department may belong to a division (optional); list can be filtered by division", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const div = (await admin.post("/api/v1/divisions").send({ name: "ฝ่ายบัญชีการเงิน" })).body.data;
    const linked = await admin.post("/api/v1/departments").send({ name: "บัญชีเจ้าหนี้", division_id: div.id });
    expect(linked.status).toBe(201);
    expect(linked.body.data.division).toEqual({ id: div.id, name: "ฝ่ายบัญชีการเงิน" });
    const free = await admin.post("/api/v1/departments").send({ name: "แผนกอิสระ" });
    expect(free.body.data.division).toBeNull();
    expect((await admin.post("/api/v1/departments").send({ name: "x", division_id: 999999 })).status).toBe(422);

    const inDiv = (await admin.get(`/api/v1/departments?division_id=${div.id}`)).body.data.map((d: { name: string }) => d.name);
    expect(inDiv).toEqual(["บัญชีเจ้าหนี้"]);
    // ย้ายออกจากฝ่าย / ลบฝ่าย = แผนกหลุดจากฝ่าย
    expect((await admin.put(`/api/v1/departments/${linked.body.data.id}`).send({ division_id: null })).body.data.division).toBeNull();
    await admin.put(`/api/v1/departments/${linked.body.data.id}`).send({ division_id: div.id });
    await admin.delete(`/api/v1/divisions/${div.id}`);
    const all = (await admin.get("/api/v1/departments?include_inactive=1")).body.data as { name: string; division: unknown }[];
    expect(all.find((d) => d.name === "บัญชีเจ้าหนี้")?.division).toBeNull();
  });
});

describe("division ↔ departments + Excel import", () => {
  it("a division picks its departments (and the department side reflects it)", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const a = (await admin.post("/api/v1/departments").send({ name: "บัญชี" })).body.data;
    const b = (await admin.post("/api/v1/departments").send({ name: "การเงิน" })).body.data;
    const div = await admin.post("/api/v1/divisions").send({ name: "ฝ่ายบัญชีการเงิน", department_ids: [a.id, b.id] });
    expect(div.status).toBe(201);
    expect(div.body.data.departments.map((d: { name: string }) => d.name).sort()).toEqual(["การเงิน", "บัญชี"]);
    const deps = (await admin.get(`/api/v1/departments?division_id=${div.body.data.id}`)).body.data;
    expect(deps).toHaveLength(2);
    // เอาออก 1 แผนก → แผนกนั้นไม่สังกัดฝ่าย
    const upd = await admin.put(`/api/v1/divisions/${div.body.data.id}`).send({ department_ids: [a.id] });
    expect(upd.body.data.departments).toEqual([{ id: a.id, name: "บัญชี" }]);
    expect((await admin.get("/api/v1/departments?include_inactive=1")).body.data.find((d: { id: number }) => d.id === b.id).division).toBeNull();
    expect((await admin.put(`/api/v1/divisions/${div.body.data.id}`).send({ department_ids: [999999] })).status).toBe(422);
  });

  it("imports divisions + departments from one workbook (match by name, division picked by name); bad rows block", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    await admin.post("/api/v1/departments").send({ name: "ขาย" });
    const book = async (divs: unknown[][], deps: unknown[][]) => {
      const wb = new ExcelJS.Workbook();
      const d1 = wb.addWorksheet("ฝ่าย");
      d1.addRow(["ชื่อ", "ลำดับ", "สถานะ"]);
      for (const r of divs) d1.addRow(r);
      const d2 = wb.addWorksheet("แผนก");
      d2.addRow(["ชื่อ", "ฝ่าย", "ลำดับ", "สถานะ"]);
      for (const r of deps) d2.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const bad = await admin.post("/api/v1/org-units/import").attach("file", await book([["ฝ่ายขาย", 1, "ใช้งาน"]], [["ขาย", "ฝ่ายที่ไม่มี", 1, ""]]), "o.xlsx");
    expect(bad.status).toBe(422);
    expect(await scalar("SELECT COUNT(*) FROM divisions")).toBe(0);

    const ok = await admin.post("/api/v1/org-units/import").attach(
      "file",
      await book([["ฝ่ายขาย", 1, "ใช้งาน"], ["ฝ่ายผลิต", 2, "ปิดใช้งาน"]], [["ขาย", "ฝ่ายขาย", 3, "ใช้งาน"], ["ผลิต 1", "ฝ่ายผลิต", "", ""], ["ธุรการ", "", "", ""]]),
      "o.xlsx",
    );
    expect(ok.body.data).toEqual({ created: 4, updated: 1 });
    const deps = (await admin.get("/api/v1/departments?include_inactive=1")).body.data as { name: string; sort_order: number; division: { name: string } | null }[];
    expect(deps.find((d) => d.name === "ขาย")).toMatchObject({ sort_order: 3, division: { name: "ฝ่ายขาย" } });
    expect(deps.find((d) => d.name === "ธุรการ")?.division).toBeNull();
    expect((await admin.get("/api/v1/divisions?include_inactive=1")).body.data.find((d: { name: string }) => d.name === "ฝ่ายผลิต").is_active).toBe(false);

    // template: 2 แผ่น เติมข้อมูลในระบบ + dropdown ฝ่าย
    const tpl = await admin.get("/api/v1/org-units/import-template").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    expect(wb.worksheets.slice(0, 2).map((w) => w.name)).toEqual(["ฝ่าย", "แผนก"]);
    expect(wb.worksheets[1].getCell("B2").dataValidation?.type).toBe("list");
    expect((await (await as(await makeUser())).post("/api/v1/org-units/import").attach("file", await book([], []), "o.xlsx")).status).toBe(403);
  });
});

describe("new roles", () => {
  it("division manager role; the IT staff role is gone — IT permissions come from the role (admin) or a group", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    expect((await admin.post("/api/v1/users").send({ name: "IT", email: "it.old@example.com", role: "it_staff", password: "Pass-1234", password_confirmation: "Pass-1234" })).status).toBe(422);
    const res = await admin.post("/api/v1/users").send({ name: "IT ใหม่", email: "it.new@example.com", role: "viewer", is_it_staff: true, password: "Pass-1234", password_confirmation: "Pass-1234" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "viewer", is_it_staff: true });
    const me = await as((await first<UserRow>("SELECT * FROM users WHERE id = ?", [res.body.data.id]))!);
    // ช่อง จนท.IT = หน้าที่ในใบแจ้งงาน ไม่ให้สิทธิ์ — ตั้งตำแหน่งผู้ดูแลระบบ (admin) แล้วจึงเห็นคิวงาน
    expect((await me.get("/api/v1/tickets?scope=it")).status).toBe(403);
    await admin.put(`/api/v1/users/${res.body.data.id}/permissions`).send({ role: "admin" });
    expect((await me.get("/api/v1/tickets?scope=it")).status).toBe(200);

    const dm = await admin.post("/api/v1/users").send({ name: "ผจก.ฝ่าย", email: "dm@example.com", role: "division_manager", password: "Pass-1234", password_confirmation: "Pass-1234" });
    expect(dm.body.data.role).toBe("division_manager");
  });

  it("local admins set a group's permissions in one go (audited)", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const dm = await as(await makeUser({ role: "division_manager" }));
    expect((await dm.get("/api/v1/users?search=a")).status).toBe(403);
    const saved = await admin.put("/api/v1/permissions/roles/division_manager").send({ keys: ["users.search", "users.view"] });
    expect(saved.body.data).toEqual(["users.view", "users.search"]);
    expect((await dm.get("/api/v1/users?search=a")).status).toBe(200);
    expect((await admin.put("/api/v1/permissions/roles/nope").send({ keys: [] })).status).toBe(404);
    expect((await admin.put("/api/v1/permissions/roles/viewer").send({ keys: ["bad.key"] })).status).toBe(422);
    expect((await dm.put("/api/v1/permissions/roles/viewer").send({ keys: [] })).status).toBe(403);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'role.permissions_updated'")).toBe(1);
  });
});

describe("system logo", () => {
  it("settings.manage uploads a logo; everyone (even logged out) can load it; ui-config exposes its version", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    expect((await guest().get("/api/v1/branding/logo")).status).toBe(404);
    expect((await (await as(await makeUser())).post("/api/v1/settings/logo").attach("logo", fakeImage(10, "png"), "logo.png")).status).toBe(403);
    expect((await admin.post("/api/v1/settings/logo").attach("logo", fakeImage(2000, "png"), "big.png")).status).toBe(422);

    const up = await admin.post("/api/v1/settings/logo").attach("logo", fakeImage(10, "png"), "logo.png");
    expect(up.status).toBe(200);
    const logo = await guest().get("/api/v1/branding/logo");
    expect(logo.status).toBe(200);
    expect(logo.headers["content-type"]).toContain("image/png");
    expect((await admin.get("/api/v1/ui-config")).body.data.logo_version).toBe(up.body.data.logo_version);

    expect((await admin.delete("/api/v1/settings/logo")).status).toBe(204);
    expect((await guest().get("/api/v1/branding/logo")).status).toBe(404);
    expect((await admin.get("/api/v1/ui-config")).body.data.logo_version).toBeNull();
  });
});
