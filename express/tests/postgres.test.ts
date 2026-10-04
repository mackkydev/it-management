import { describe, expect, it } from "vitest";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/** พฤติกรรมที่ต้องคงเดิมหลังย้ายจาก MariaDB (collation ไม่สนตัวพิมพ์) มา PostgreSQL */
describe("PostgreSQL behaviour parity", () => {
  it("unique checks ignore letter case (like MariaDB utf8mb4_unicode_ci)", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    await makeBranch({ code: "PKT" });
    const dup = await admin.post("/api/v1/branches").send({ code: "pkt", name: "ภูเก็ต" });
    expect(dup.status).toBe(422);
    expect(dup.body.errors).toHaveProperty("code");

    await makeUser({ email: "taken@example.com" });
    const email = await admin.post("/api/v1/users").send({ name: "x", email: "TAKEN@example.com", role: "viewer", password: "Secret123" });
    expect(email.body.errors).toHaveProperty("email");
  });

  it("search is case-insensitive and matches part of a Thai word", async () => {
    const api = await as(await makeUser());
    await makeAsset({ asset_tag: "NB-001", name: "โน้ตบุ๊ก Dell Latitude", brand: "Dell" });
    await makeAsset({ asset_tag: "PR-001", name: "เครื่องพิมพ์", brand: "Canon" });

    expect((await api.get("/api/v1/assets?search=nb-0")).body.data.map((a: { asset_tag: string }) => a.asset_tag)).toEqual(["NB-001"]);
    expect((await api.get("/api/v1/assets?search=latitude")).body.data).toHaveLength(1);
    expect((await api.get(`/api/v1/assets?search=${encodeURIComponent("พิมพ์")}`)).body.data[0].asset_tag).toBe("PR-001");
    expect((await api.get("/api/v1/users?search=x")).status).toBe(403); // viewer
  });

  it("malformed uuid in the URL is 404, not a database error", async () => {
    const api = await as(await makeUser({ role: "admin" }));
    expect((await api.get("/api/v1/assets/not-a-uuid")).status).toBe(404);
    expect((await api.get("/api/v1/tickets/123")).status).toBe(404);
    expect((await api.post("/api/v1/notifications/abc/read")).status).toBe(204);
  });

  it("login email is case-insensitive", async () => {
    await makeUser({ email: "case@example.com", password: "Pass-1234" });
    const res = await (await import("./helpers.js")).guest().post("/api/v1/auth/login").send({ email: "CASE@Example.com", password: "Pass-1234", device_name: "t" });
    expect(res.status).toBe(200);
  });
});
