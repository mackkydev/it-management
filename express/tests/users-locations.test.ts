import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { verifyHash } from "../src/lib/validator.js";
import { as, guest, makeAsset, makeLocation, makeUser, tokenFor } from "./helpers.js";

/** ตรงกับ UserManagementTest / UserApiTest / LocationApiTest ของ Laravel */
describe("user management", () => {
  it("admin can create a user with role", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const res = await api.post("/api/v1/users").send({ name: "New Manager", email: "MGR@example.com", role: "manager", password: "Secret123" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "manager", email: "mgr@example.com", is_active: true, custodian_assets_count: 0, branch: null });
    const row = await first<{ password: string }>("SELECT password FROM users WHERE id = ?", [res.body.data.id]);
    expect(verifyHash("Secret123", row!.password)).toBe(true);

    const bad = await api.post("/api/v1/users").send({ name: "x", email: "mgr@example.com", role: "viewer", password: "short" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("deactivate or password reset revokes tokens; inactive cannot login", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const user = await makeUser();
    await tokenFor(user, "phone");
    const count = async () => Number(await scalar("SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_id = ?", [user.id]));

    expect((await api.patch(`/api/v1/users/${user.id}`).send({ password: "NewPass123" })).status).toBe(200);
    expect(await count()).toBe(0);

    await tokenFor(user, "phone");
    const res = await api.patch(`/api/v1/users/${user.id}`).send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
    expect(await count()).toBe(0);

    const login = await guest().post("/api/v1/auth/login").send({ email: user.email, password: "NewPass123", device_name: "t" });
    expect(login.status).toBe(422);
  });

  it("admin cannot lock out or delete self", async () => {
    const admin = await makeUser({ role: "admin" });
    const api = await as(admin);
    const role = await api.patch(`/api/v1/users/${admin.id}`).send({ role: "viewer" });
    expect(role.status).toBe(422);
    expect(role.body.errors.role[0]).toBe("ไม่สามารถลดบทบาทหรือปิดใช้งานบัญชีของตัวเองได้");
    expect((await api.patch(`/api/v1/users/${admin.id}`).send({ is_active: false })).body.errors).toHaveProperty("is_active");
    expect((await api.delete(`/api/v1/users/${admin.id}`)).status).toBe(422);
    expect((await api.patch(`/api/v1/users/${admin.id}`).send({ name: "Still Admin" })).status).toBe(200);
  });

  it("only users without history can be deleted", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const holder = await makeUser();
    await makeAsset({ custodian_id: holder.id });
    const fresh = await makeUser();

    expect((await api.get(`/api/v1/users/${holder.id}`)).body.meta.can_delete).toBe(false);
    expect((await api.delete(`/api/v1/users/${holder.id}`)).status).toBe(422);
    expect((await api.delete(`/api/v1/users/${fresh.id}`)).status).toBe(204);
    expect(await first("SELECT id FROM users WHERE id = ?", [fresh.id])).toBeNull();
  });

  it("manage list is admin only and filters", async () => {
    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.get("/api/v1/users?manage=1")).status).toBe(403);
    expect((await manager.post("/api/v1/users").send({})).status).toBe(403);
    expect((await manager.get("/api/v1/users")).status).toBe(200);

    const admin = await as(await makeUser({ role: "admin" }));
    await makeUser({ name: "Zed Inactive", is_active: false });
    const res = await admin.get("/api/v1/users?manage=1&status=inactive");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Zed Inactive");
    expect(res.body.meta.total).toBe(1);
  });

  it("custodian picker: manager searches active users only, without role", async () => {
    const api = await as(await makeUser({ role: "manager", name: "Acting User" }));
    await makeUser({ name: "Somchai Jaidee", email: "somchai@example.com" });
    await makeUser({ name: "Somchai Retired", is_active: false });

    const res = await api.get("/api/v1/users?search=somchai");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({ id: expect.any(Number), name: "Somchai Jaidee", email: "somchai@example.com" });
    expect(res.body.links.last).toBeNull();
  });

  it("viewer cannot list users", async () => {
    expect((await (await as(await makeUser())).get("/api/v1/users")).status).toBe(403);
  });
});

describe("locations", () => {
  it("manager can create and update a location", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const site = await makeLocation({ type: "site" });

    const created = await api.post("/api/v1/locations").send({ code: "HQ-C", name: "อาคาร C", type: "building", parent_id: site });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ is_active: true, parent_id: site, assets_count: 0, children_count: 0 });
    const id = created.body.data.id;

    const patched = await api.patch(`/api/v1/locations/${id}`).send({ name: "อาคาร C (ใหม่)", is_active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ name: "อาคาร C (ใหม่)", is_active: false });

    expect((await api.get("/api/v1/locations")).body.data.map((l: { id: number }) => l.id)).not.toContain(id);
    const all = await api.get("/api/v1/locations?include_inactive=1");
    expect(all.body.data).toContainEqual(expect.objectContaining({ id, children_count: 0, assets_count: 0 }));
  });

  it("quick add with a name only gets the next LOC-#### code and type room", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    await makeLocation({ code: "LOC-0007" });
    const created = await api.post("/api/v1/locations").send({ name: "ห้องประชุมใหญ่" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "LOC-0008", name: "ห้องประชุมใหญ่", type: "room" });
    expect((await api.post("/api/v1/locations").send({ name: "ห้อง Server" })).body.data.code).toBe("LOC-0009");
    expect((await api.post("/api/v1/locations").send({ name: "" })).status).toBe(422);
  });

  it("code must be unique and parent cannot create a cycle", async () => {
    const api = await as(await makeUser({ role: "manager" }));
    const a = await makeLocation({ code: "A" });
    const b = await makeLocation({ code: "B", parent_id: a });
    const c = await makeLocation({ code: "C", parent_id: b });

    expect((await api.post("/api/v1/locations").send({ code: "A", name: "x", type: "room" })).body.errors).toHaveProperty("code");
    const cycle = await api.patch(`/api/v1/locations/${a}`).send({ parent_id: c });
    expect(cycle.status).toBe(422);
    expect(cycle.body.errors.parent_id[0]).toBe("สถานที่แม่ต้องไม่ใช่ตัวเองหรือสถานที่ย่อยของตัวเอง");
    expect((await api.patch(`/api/v1/locations/${a}`).send({ parent_id: a })).body.errors).toHaveProperty("parent_id");
  });

  it("delete is blocked while the location has children or assets", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    const parent = await makeLocation();
    const child = await makeLocation({ parent_id: parent });
    await makeAsset({ location_id: child });

    expect((await api.delete(`/api/v1/locations/${parent}`)).status).toBe(422);
    expect((await api.delete(`/api/v1/locations/${child}`)).status).toBe(422);
    const empty = await makeLocation();
    expect((await api.delete(`/api/v1/locations/${empty}`)).status).toBe(204);
    expect(Boolean(await scalar("SELECT deleted_at IS NOT NULL FROM locations WHERE id = ?", [empty]))).toBe(true);
  });

  it("permissions", async () => {
    const viewer = await as(await makeUser());
    const loc = await makeLocation();
    expect((await viewer.get("/api/v1/locations")).status).toBe(200);
    expect((await viewer.get(`/api/v1/locations/${loc}`)).status).toBe(200);
    expect((await viewer.get("/api/v1/locations?include_inactive=1")).status).toBe(403);
    expect((await viewer.post("/api/v1/locations").send({ code: "X", name: "x", type: "room" })).status).toBe(403);

    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.delete(`/api/v1/locations/${loc}`)).status).toBe(403);
  });
});
