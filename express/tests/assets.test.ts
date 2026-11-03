import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { verifyHash } from "../src/lib/validator.js";
import { as, guest, makeAsset, makeBranch, makeLocation, makeUser, tokenFor } from "./helpers.js";

/** ตรงกับ AssetApiTest / ProfileAndLocaleTest / UserApiTest / AssetMovementApiTest ของ Laravel */
describe("auth + assets", () => {
  it("guest gets 401 json", async () => {
    const res = await guest().get("/api/v1/assets");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.message).toBe("Unauthenticated.");
  });

  it("login returns a Sanctum-format bearer token that authenticates", async () => {
    await makeUser({ email: "a@example.com", password: "secret-pass" });
    const ok = await guest().post("/api/v1/auth/login").send({ email: "A@example.com", password: "secret-pass", device_name: "vitest" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token_type: "Bearer", user: { email: "a@example.com", role: "viewer" } });
    expect(ok.body.token).toMatch(/^\d+\|[A-Za-z0-9]{40}[0-9a-f]{8}$/);
    expect(ok.body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);

    const me = await guest().get("/api/v1/auth/me").set("Authorization", `Bearer ${ok.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email: "a@example.com", branch: null, supervisor: null, is_it_staff: false });

    const bad = await guest().post("/api/v1/auth/login").send({ email: "a@example.com", password: "wrong", device_name: "vitest" });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.email[0]).toBe("อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง");
  });

  it("logout revokes only the current token", async () => {
    const u = await makeUser();
    const other = await tokenFor(u, "phone");
    const api = await as(u);
    expect((await api.post("/api/v1/auth/logout")).status).toBe(204);
    expect(Number(await scalar("SELECT COUNT(*) FROM personal_access_tokens"))).toBe(1);
    expect((await guest().get("/api/v1/auth/me").set("Authorization", `Bearer ${other}`)).status).toBe(200);
  });

  it("index paginates and filters", async () => {
    const api = await as(await makeUser({ is_it_staff: true })); // ฝ่าย IT เห็นสินทรัพย์ทั้งหมด
    for (let i = 0; i < 5; i++) await makeAsset({ status: "active" });
    for (let i = 0; i < 2; i++) await makeAsset({ status: "in_repair" });

    const res = await api.get("/api/v1/assets?status=in_repair&per_page=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 2, current_page: 1, last_page: 1, per_page: 10, from: 1, to: 2 });
    expect(res.body.data[0]).not.toHaveProperty("uuid");
    expect(res.body.links).toHaveProperty("next", null);

    expect((await api.get("/api/v1/assets?sort=password")).status).toBe(422);
  });

  it("manager can create and update but not delete", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const loc = await makeLocation();

    const created = await api.post("/api/v1/assets").send({ asset_tag: "IT-2026-000001", name: "Notebook", category: "IT", location_id: loc });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "active", status_label: "ใช้งาน", location: { id: loc, is_active: true } });
    const id = created.body.data.id;

    const patched = await api.patch(`/api/v1/assets/${id}`).send({ status: "in_repair" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe("in_repair");

    expect((await api.delete(`/api/v1/assets/${id}`)).status).toBe(403);
  });

  it("viewer cannot create (valid data → 403)", async () => {
    const api = await as(await makeUser());
    const res = await api.post("/api/v1/assets").send({ asset_tag: "X-1", name: "x", category: "IT" });
    expect(res.status).toBe(403);
  });

  it("admin soft deletes", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const asset = await makeAsset();
    expect((await api.delete(`/api/v1/assets/${asset.uuid}`)).status).toBe(204);
    expect(Boolean(await scalar("SELECT deleted_at IS NOT NULL FROM assets WHERE id = ?", [asset.id]))).toBe(true);
    expect((await api.get(`/api/v1/assets/${asset.uuid}`)).status).toBe(404);
  });

  it("custodian must be an active user", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const active = await makeUser();
    const inactive = await makeUser({ is_active: false });

    const bad = await api.post("/api/v1/assets").send({ name: "Notebook", category: "IT", asset_tag: "IT-1", custodian_id: inactive.id });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toHaveProperty("custodian_id");

    const ok = await api.post("/api/v1/assets").send({ name: "Notebook", category: "IT", asset_tag: "IT-2", custodian_id: active.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.custodian.id).toBe(active.id);
  });
});

describe("profile + locale", () => {
  it("user can update own name and email but not role", async () => {
    const u = await makeUser();
    const res = await (await as(u)).patch("/api/v1/auth/me").send({ name: "New Name", email: "NEW@Example.com", role: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "New Name", email: "new@example.com", role: "viewer" });
  });

  it("password change requires current password and revokes other tokens", async () => {
    const u = await makeUser({ password: "old-pass-1" });
    await tokenFor(u, "other-device");
    const api = await as(u);

    const wrong = await api.put("/api/v1/auth/password").send({ current_password: "wrong", password: "new-pass-2", password_confirmation: "new-pass-2" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.errors).toHaveProperty("current_password");

    const ok = await api.put("/api/v1/auth/password").send({ current_password: "old-pass-1", password: "new-pass-2", password_confirmation: "new-pass-2" });
    expect(ok.status).toBe(204);

    const row = await first<{ password: string }>("SELECT password FROM users WHERE id = ?", [u.id]);
    expect(row!.password.startsWith("$2y$")).toBe(true);
    expect(verifyHash("new-pass-2", row!.password)).toBe(true);
    expect(Number(await scalar("SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_id = ?", [u.id]))).toBe(1);
  });

  it("messages follow Accept-Language", async () => {
    const manager = await makeUser({ role: "manager" });
    await makeAsset({ status: "in_repair" });

    const en = await (await as(manager, "en")).get("/api/v1/assets");
    expect(en.body.data[0].status_label).toBe("In repair");
    expect(en.headers["content-language"]).toBe("en");

    const th = await (await as(manager, "th-TH,th;q=0.9")).get("/api/v1/assets");
    expect(th.body.data[0].status_label).toBe("ส่งซ่อม");

    const thErr = await (await as(manager, "th")).post("/api/v1/assets").send({});
    expect(thErr.body.errors.asset_tag[0]).toBe("กรุณากรอกเลขที่ทรัพย์สิน");
    const enErr = await (await as(manager, "en")).post("/api/v1/assets").send({});
    expect(enErr.body.errors.asset_tag[0]).toBe("The asset tag field is required.");
  });

  it("global movements report filters by asset tag", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const room = await makeLocation();
    for (const tag of ["IT-AAA-1", "IT-BBB-1"]) {
      expect((await api.post("/api/v1/assets").send({ asset_tag: tag, name: "x", category: "IT", location_id: room })).status).toBe(201);
    }
    const res = await api.get("/api/v1/movements?search=IT-AAA");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].asset.asset_tag).toBe("IT-AAA-1");
  });
});

describe("asset movements", () => {
  it("creating an asset with a location records registration", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const room = await makeLocation();
    const id = (await api.post("/api/v1/assets").send({ asset_tag: "IT-1", name: "Notebook", category: "IT", location_id: room })).body.data.id;

    const res = await api.get(`/api/v1/assets/${id}/movements`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: "registered", type_label: "ลงทะเบียน", to_location: { id: room }, from_location: null });
  });

  it("updating location (sent as string) records a transfer with reason", async () => {
    const manager = await makeUser({ role: "manager" });
    const api = await as(manager);
    const a = await makeLocation();
    const b = await makeLocation();
    const asset = await makeAsset({ location_id: a });

    expect((await api.patch(`/api/v1/assets/${asset.uuid}`).send({ location_id: String(b), movement_reason: "ย้ายแผนก" })).status).toBe(200);
    const row = await first("SELECT * FROM asset_movements WHERE asset_id = ?", [asset.id]);
    expect(row).toMatchObject({ type: "transfer", from_location_id: a, to_location_id: b, reason: "ย้ายแผนก", performed_by: manager.id });
  });

  it("update without location change records nothing", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const room = await makeLocation();
    const asset = await makeAsset({ location_id: room });
    expect((await api.patch(`/api/v1/assets/${asset.uuid}`).send({ name: "Renamed", location_id: String(room) })).status).toBe(200);
    expect(Number(await scalar("SELECT COUNT(*) FROM asset_movements"))).toBe(0);
  });

  it("transfer endpoint moves the asset and logs", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const room = await makeLocation();
    const custodian = await makeUser();
    const asset = await makeAsset();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace("T", " ");

    const res = await api.post(`/api/v1/assets/${asset.uuid}/movements`).send({ location_id: room, custodian_id: custodian.id, moved_at: yesterday, reason: "มอบให้พนักงานใหม่" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ to_location: { id: room }, to_custodian: { id: custodian.id } });
    const a = await first<{ location_id: number; custodian_id: number }>("SELECT location_id, custodian_id FROM assets WHERE id = ?", [asset.id]);
    expect(a).toEqual({ location_id: room, custodian_id: custodian.id });
  });

  it("transfer without change / without target / with future date is rejected", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const room = await makeLocation();
    const asset = await makeAsset({ location_id: room });

    const same = await api.post(`/api/v1/assets/${asset.uuid}/movements`).send({ location_id: room });
    expect(same.status).toBe(422);
    expect(same.body.errors).toHaveProperty("location_id");

    const none = await api.post(`/api/v1/assets/${asset.uuid}/movements`).send({ reason: "x" });
    expect(none.status).toBe(422);
    expect(none.body.errors.location_id[0]).toBe("กรุณาระบุสถานที่หรือผู้ถือครองที่ต้องการโอนย้าย");

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    const future = await api.post(`/api/v1/assets/${asset.uuid}/movements`).send({ location_id: await makeLocation(), moved_at: tomorrow });
    expect(future.status).toBe(422);
    expect(future.body.errors.moved_at[0]).toBe("วันที่โอนย้ายต้องไม่เกินเวลาปัจจุบัน");
  });

  it("a holder with assets.view can read history of their own asset but not transfer", async () => {
    const user = await makeUser({ role: "division_manager" });
    const api = await as(user);
    const asset = await makeAsset({ custodian_id: user.id });
    expect((await api.get(`/api/v1/assets/${asset.uuid}/movements`)).status).toBe(200);
    expect((await api.post(`/api/v1/assets/${asset.uuid}/movements`).send({ location_id: await makeLocation() })).status).toBe(403);
  });

  it("viewers have no assets menu by default (repair form still lists their assets)", async () => {
    const user = await makeUser();
    const api = await as(user);
    const mine = await makeAsset({ asset_tag: "VIEWER-1", custodian_id: user.id });
    expect((await api.get("/api/v1/assets")).status).toBe(403);
    expect((await api.get(`/api/v1/assets/${mine.uuid}`)).status).toBe(404);
    const options = (await api.get("/api/v1/tickets/form-options")).body.data;
    expect(options.my_assets.map((a: { asset_tag: string }) => a.asset_tag)).toContain("VIEWER-1");
  });

  it("users without assets.view_all only see assets they hold (custodian or matching user name)", async () => {
    const user = await makeUser({ name: "สมชาย ใจดี", role: "division_manager" });
    const api = await as(user);
    const mine = await makeAsset({ asset_tag: "MINE-1", custodian_id: user.id });
    const byName = await makeAsset({ asset_tag: "PC-001", category: "COMPUTER", user_name: " สมชาย ใจดี " });
    const other = await makeAsset({ asset_tag: "OTHER-1" });

    const list = await api.get("/api/v1/assets");
    expect(list.body.data.map((a: { asset_tag: string }) => a.asset_tag).sort()).toEqual(["MINE-1", "PC-001"]);
    expect((await api.get(`/api/v1/assets/${mine.uuid}`)).status).toBe(200);
    expect((await api.get(`/api/v1/assets/${byName.uuid}`)).status).toBe(200);
    expect((await api.get(`/api/v1/assets/${other.uuid}`)).status).toBe(404);
    expect((await api.get(`/api/v1/assets/${other.uuid}/movements`)).status).toBe(404);
    expect((await api.get("/api/v1/movements")).status).toBe(403);

    // ฝ่าย IT (assets.view_all) เห็นทั้งหมด
    const it = await as(await makeUser({ is_it_staff: true }));
    expect((await it.get("/api/v1/assets")).body.meta.total).toBe(3);
    expect((await it.get("/api/v1/movements")).status).toBe(200);
  });
});

describe("shared holder and editable categories", () => {
  it("a shared asset has no user holder, needs a branch, and stops being shared when given to someone", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    const person = await makeUser({ name: "สมชาย" });
    const branch = await makeBranch();
    const base = { asset_tag: "SH-1", name: "Printer", category: "ปริ้นเตอร์" };
    expect((await api.post("/api/v1/assets").send({ ...base, is_shared: true })).status).toBe(422);

    const made = await api.post("/api/v1/assets").send({ ...base, is_shared: true, branch_id: branch, department: "บัญชี", custodian_id: person.id });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ is_shared: true, custodian: null, user_name: "ส่วนกลาง", department: "บัญชี", category: "ปริ้นเตอร์" });
    const id = made.body.data.id;

    expect((await api.patch(`/api/v1/assets/${id}`).send({ branch_id: null })).status).toBe(422);
    // แก้ช่องอื่น = ยังเป็นส่วนกลาง
    expect((await api.patch(`/api/v1/assets/${id}`).send({ notes: "x" })).body.data.is_shared).toBe(true);
    // เลือกผู้ถือครอง = เลิกเป็นส่วนกลาง
    const given = await api.patch(`/api/v1/assets/${id}`).send({ custodian_id: person.id });
    expect(given.body.data).toMatchObject({ is_shared: false, user_name: "สมชาย" });
    // กลับเป็นส่วนกลาง แล้วเอาติ๊กออก = ไม่มีผู้ใช้งานค้าง
    expect((await api.patch(`/api/v1/assets/${id}`).send({ is_shared: true })).body.data).toMatchObject({ custodian: null, user_name: "ส่วนกลาง" });
    expect((await api.patch(`/api/v1/assets/${id}`).send({ is_shared: false })).body.data).toMatchObject({ is_shared: false, user_name: null });
    // โอนย้ายให้ผู้ใช้ = เลิกเป็นส่วนกลาง
    await api.patch(`/api/v1/assets/${id}`).send({ is_shared: true });
    expect((await api.post(`/api/v1/assets/${id}/movements`).send({ custodian_id: person.id, reason: "x" })).status).toBe(201);
    expect((await api.get(`/api/v1/assets/${id}`)).body.data).toMatchObject({ is_shared: false, user_name: "สมชาย" });
  });

  it("categories live in the dropdown list: rename follows assets, fixed codes are reserved", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    expect((await api.post("/api/v1/dropdown-options/asset_category").send({ name: "computer" })).status).toBe(422);
    const added = await api.post("/api/v1/dropdown-options/asset_category").send({ name: "กล้องวงจรปิด" });
    expect(added.status).toBe(201);
    const asset = await api.post("/api/v1/assets").send({ asset_tag: "CAM-1", name: "CCTV", category: "กล้องวงจรปิด" });
    expect((await api.put(`/api/v1/dropdown-options/asset_category/${added.body.data.id}`).send({ name: "CCTV" })).status).toBe(200);
    expect((await api.get(`/api/v1/assets/${asset.body.data.id}`)).body.data.category).toBe("CCTV");
  });
});

describe("asset number field", () => {
  it("a computer keeps its number in cpu_tag and its Host Name in asset_tag; numbers cannot repeat; search finds the number", async () => {
    const api = await as(await makeUser({ role: "super_admin" }));
    await api.post("/api/v1/assets").send({ asset_tag: "PR-100", name: "Printer", category: "ปริ้นเตอร์" });
    const pc = { name: "Desktop", category: "COMPUTER" };
    const made = await api.post("/api/v1/assets").send({ ...pc, asset_tag: "HOST-1", cpu_tag: "NO-1" });
    expect(made.body.data).toMatchObject({ asset_tag: "HOST-1", cpu_tag: "NO-1" });
    const id = made.body.data.id;

    expect((await api.post("/api/v1/assets").send({ ...pc, asset_tag: "HOST-2", cpu_tag: "NO-1" })).body.errors.cpu_tag).toBeTruthy();
    expect((await api.post("/api/v1/assets").send({ ...pc, asset_tag: "HOST-2", cpu_tag: "PR-100" })).body.errors.cpu_tag).toBeTruthy();
    expect((await api.post("/api/v1/assets").send({ asset_tag: "NO-1", name: "x", category: "ปริ้นเตอร์" })).body.errors.asset_tag).toBeTruthy();
    // Host Name ซ้ำ = ข้อความของ Host Name
    expect((await api.post("/api/v1/assets", ).set("Accept-Language", "en").send({ ...pc, asset_tag: "HOST-1", cpu_tag: "NO-2" })).body.errors.asset_tag[0]).toBe("This Host Name already exists.");
    // แก้ช่องอื่นโดยเลขเดิม ไม่ถูกกัน และคอมพิวเตอร์เดิมไม่มีเลขยังแก้ได้
    expect((await api.patch(`/api/v1/assets/${id}`).send({ cpu_tag: "NO-1", notes: "x" })).status).toBe(200);
    const old = await makeAsset({ asset_tag: "HOST-OLD", category: "COMPUTER" });
    const oldUuid = (await api.get("/api/v1/assets?search=HOST-OLD")).body.data[0].id;
    expect(old.id).toBeGreaterThan(0);
    expect((await api.patch(`/api/v1/assets/${oldUuid}`).send({ notes: "x" })).status).toBe(200);

    expect((await api.get("/api/v1/assets?search=NO-1")).body.data.map((a: { asset_tag: string }) => a.asset_tag)).toEqual(["HOST-1"]);
  });
});
