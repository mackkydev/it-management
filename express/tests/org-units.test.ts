import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import type { UserRow } from "../src/models/user.js";
import { as, fakeImage, guest, makeUser } from "./helpers.js";

/** แผนก/ฝ่าย (ข้อมูลหลัก), บทบาทใหม่, โลโก้ระบบ, สิทธิ์ของกลุ่ม */
describe("departments / divisions", () => {
  it("anyone can list active ones; only org.manage can manage; renames follow into users", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
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
    const admin = await as(await makeUser({ role: "admin" }));
    const d = await admin.post("/api/v1/divisions").send({ name: "ฝ่ายขาย" });
    expect(d.status).toBe(201);
    expect((await admin.delete(`/api/v1/divisions/${d.body.data.id}`)).status).toBe(204);
  });
});

describe("new roles", () => {
  it("division manager and IT staff roles; picking IT staff ticks the IT flag", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    const res = await admin.post("/api/v1/users").send({ name: "IT ใหม่", email: "it.new@example.com", role: "it_staff", password: "Pass-1234" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "it_staff", is_it_staff: true });
    const me = await as((await first<UserRow>("SELECT * FROM users WHERE id = ?", [res.body.data.id]))!);
    expect((await me.get("/api/v1/tickets?scope=it")).status).toBe(200);

    const dm = await admin.post("/api/v1/users").send({ name: "ผจก.ฝ่าย", email: "dm@example.com", role: "division_manager", password: "Pass-1234" });
    expect(dm.body.data.role).toBe("division_manager");
  });

  it("local admins set a group's permissions in one go (audited)", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
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
    const admin = await as(await makeUser({ role: "admin" }), "th");
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
