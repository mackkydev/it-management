import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
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

    // template: แผ่นเดียว Unit Code | Description | ชื่อไทย (เติมข้อมูลในระบบ — ฝ่าย/แผนกชื่อซ้ำกันแสดงครั้งเดียว)
    const tpl = await admin.get("/api/v1/org-units/import-template").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    expect(wb.worksheets[0].name).toBe("หน่วยงาน");
    expect([1, 2, 3].map((c) => wb.worksheets[0].getRow(1).getCell(c).value)).toEqual(["Unit Code", "Description", "ชื่อไทย"]);
    expect((await (await as(await makeUser())).post("/api/v1/org-units/import").attach("file", await book([], []), "o.xlsx")).status).toBe(403);
  });

  it("imports the SyteLine Unit Code list (UTF-16 tab file) as both divisions and departments", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    await insert("departments", { name: "เทคโนโลยีสาระสนเทศ", is_active: true, sort_order: 0, created_at: nowDb(), updated_at: nowDb() });
    // ฝ่ายเดิมตั้งชื่อเป็นตัวย่อ ("AF") = จับคู่ด้วยตัวย่อ ไม่เปลี่ยนชื่อ
    await insert("divisions", { name: "AF", is_active: true, sort_order: 0, created_at: nowDb(), updated_at: nowDb() });
    const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const file = (lines: string[]) => utf16(["Unit Code\tDescription\t", ...lines].join("\r\n") + "\r\n");

    // ตัวย่อซ้ำในไฟล์ = ไม่บันทึกเลย
    const dup = await admin.post("/api/v1/org-units/import").attach("file", file(["IS\tISO\tควบคุมคุณภาพ", "IS\tISO 2\tมาตรฐาน"]), "u.csv");
    expect(dup.status).toBe(422);
    expect(dup.body.rows[0].row).toBe(3);
    expect(await scalar("SELECT COUNT(*) FROM divisions WHERE code IS NOT NULL")).toBe(0);

    // ชื่อไทยซ้ำ (ตัวย่อต่างกัน) = แถวหลังเติมตัวย่อท้ายชื่อ
    const same = await admin.post("/api/v1/org-units/import").attach("file", file(["IS\tISO\tควบคุมคุณภาพ", "QC\tFactory-Quality Control\tควบคุมคุณภาพ"]), "u.csv");
    expect(same.status).toBe(200);
    expect(await scalar("SELECT name FROM departments WHERE code = 'QC'")).toBe("ควบคุมคุณภาพ (QC)");
    expect(await scalar("SELECT name FROM divisions WHERE code = 'IS'")).toBe("ควบคุมคุณภาพ");
    await exec("DELETE FROM departments WHERE code IN ('IS', 'QC')");
    await exec("DELETE FROM divisions WHERE code IN ('IS', 'QC')");

    const ok = await admin
      .post("/api/v1/org-units/import")
      .attach("file", file(["AF\tAccounting and Financial\tบัญชีและการเงินสำนักงานใหญ่", "IT\tInformation and Communication Technology\tเทคโนโลยีสาระสนเทศ", "LO\tLogistic\t"]), "u.csv");
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ created: 4, updated: 2 }); // ฝ่าย 2 ใหม่ + ฝ่าย "AF" เดิม, แผนก 2 ใหม่ + แผนก IT เดิมได้ตัวย่อ
    expect(await scalar("SELECT name FROM divisions WHERE code = 'AF'")).toBe("AF");
    const deps = (await admin.get("/api/v1/departments?include_inactive=1")).body.data as { name: string; code: string; name_en: string; division: { name: string } | null }[];
    expect(deps.find((d) => d.code === "IT")).toMatchObject({ name: "เทคโนโลยีสาระสนเทศ", name_en: "Information and Communication Technology", division: { name: "เทคโนโลยีสาระสนเทศ" } });
    expect(deps.find((d) => d.code === "LO")?.name).toBe("Logistic"); // ไม่มีชื่อไทย = ชื่ออังกฤษ
    const divs = (await admin.get("/api/v1/divisions?include_inactive=1")).body.data as { code: string }[];
    expect(divs.map((d) => d.code).sort()).toEqual(["AF", "IT", "LO"]);

    // นำเข้าซ้ำ = อัปเดต (ไม่เพิ่ม)
    const again = await admin.post("/api/v1/org-units/import").attach("file", file(["AF\tAccounting & Finance\tบัญชีและการเงินสำนักงานใหญ่"]), "u.txt");
    expect(again.body.data).toEqual({ created: 0, updated: 2 });
    expect(await scalar("SELECT name_en FROM divisions WHERE code = 'AF'")).toBe("Accounting & Finance");
  });

  it("single tab: a department saved with mirror_division keeps the same-named division in step", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const c = await admin.post("/api/v1/departments").send({ name: "จัดซื้อ", code: "PC", name_en: "Procurement", mirror_division: true });
    expect(c.status).toBe(201);
    expect(c.body.data.division).toMatchObject({ name: "จัดซื้อ" });
    expect(await scalar("SELECT CONCAT(code, '|', name_en) FROM divisions WHERE name = 'จัดซื้อ'")).toBe("PC|Procurement");

    const user = await makeUser({ division: "จัดซื้อ" });
    const u = await admin.put(`/api/v1/departments/${c.body.data.id}`).send({ name: "จัดซื้อกลาง", code: "PC", is_active: false, mirror_division: true });
    expect(u.status).toBe(200);
    expect(await scalar("SELECT CONCAT(name, '|', is_active) FROM divisions WHERE code = 'PC'")).toBe("จัดซื้อกลาง|0");
    expect(await scalar("SELECT division FROM users WHERE id = ?", [user.id])).toBe("จัดซื้อกลาง");

    // ฝ่ายคู่กันยังมีผู้ใช้ = ลบไม่ได้
    expect((await admin.delete(`/api/v1/departments/${c.body.data.id}?mirror_division=1`)).status).toBe(422);
    await exec("UPDATE users SET division = NULL WHERE id = ?", [user.id]);
    expect((await admin.delete(`/api/v1/departments/${c.body.data.id}?mirror_division=1`)).status).toBe(204);
    expect(await scalar("SELECT COUNT(*) FROM divisions WHERE code = 'PC'")).toBe(0);
  });

  it("saves code and English name on a unit; codes are unique", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const a = await admin.post("/api/v1/departments").send({ name: "ขนส่ง", code: "LO", name_en: "Logistic" });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ code: "LO", name_en: "Logistic" });
    expect((await admin.post("/api/v1/departments").send({ name: "ขนส่งสาขา", code: "LO" })).status).toBe(422);
    expect((await admin.post("/api/v1/departments").send({ name: "ขนส่ง 2", code: "L O" })).status).toBe(422);
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

describe("system name", () => {
  it("settings.manage sets the name and tagline; everyone (even logged out) can read them; empty = defaults", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }), "th");
    expect((await guest().get("/api/v1/branding")).body.data).toEqual({ name: "", tagline: "" });
    expect((await (await as(await makeUser())).put("/api/v1/settings/branding").send({ name: "X", tagline: "Y" })).status).toBe(403);
    expect((await admin.put("/api/v1/settings/branding").send({ name: "x".repeat(31), tagline: "" })).status).toBe(422);
    expect((await admin.put("/api/v1/settings/branding").send({ name: "", tagline: "x".repeat(61) })).status).toBe(422);

    expect((await admin.put("/api/v1/settings/branding").send({ name: "  ACME\n  Desk ", tagline: "ฝ่ายไอที" })).body.data).toEqual({ name: "ACME Desk", tagline: "ฝ่ายไอที" });
    expect((await guest().get("/api/v1/branding")).body.data).toEqual({ name: "ACME Desk", tagline: "ฝ่ายไอที" });

    expect((await admin.put("/api/v1/settings/branding").send({ name: "", tagline: "" })).status).toBe(200);
    expect((await guest().get("/api/v1/branding")).body.data).toEqual({ name: "", tagline: "" });
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
