import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { as, makeUser } from "./helpers.js";

/** ลายนิ้วมือข้อมูลสำหรับ real-time refresh — ตรงกับ SyncTest ของ Laravel */
describe("sync version", () => {
  it("changes when data is added or removed and requires login", async () => {
    expect((await request(createApp()).get("/api/v1/sync/version").set("Accept", "application/json")).status).toBe(401);

    const api = await as(await makeUser({ is_it_staff: true }));
    const version = async () => (await api.get("/api/v1/sync/version")).body.data.version as string;
    const v1 = await version();
    expect(v1).toMatch(/^[0-9a-f]{32}$/);
    expect(await version()).toBe(v1);

    const created = await api.post("/api/v1/announcements").send({ title: "ประกาศ", level: "info" });
    const v2 = await version();
    expect(v2).not.toBe(v1);
    await api.delete(`/api/v1/announcements/${created.body.data.id}`);
    expect(await version()).not.toBe(v2);
  });
});
