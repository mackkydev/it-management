import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { localToday } from "../src/lib/time.js";
import { as, localDay, makeUser } from "./helpers.js";

/** ประกาศจากฝ่าย IT บนหน้า login — ตรงกับ AnnouncementTest ของ Laravel */
describe("announcements", () => {
  it("IT manages announcements; the public list shows only active ones in range", async () => {
    const it_ = await as(await makeUser({ is_it_staff: true }), "th");
    expect((await (await as(await makeUser())).post("/api/v1/announcements").send({ title: "x", level: "info" })).status).toBe(403);

    const bad = await it_.post("/api/v1/announcements").send({ title: "", level: "x", starts_on: localDay(5), ends_on: localDay(1) });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["ends_on", "level", "title"]);
    const order = await it_.post("/api/v1/announcements").send({ title: "ระบบ", level: "info", starts_on: localDay(5), ends_on: localDay(1) });
    expect(order.body.errors.ends_on[0]).toBe("วันสิ้นสุดต้องไม่ก่อนวันเริ่มแสดง");

    const created = await it_.post("/api/v1/announcements").send({ title: "ปิดปรับปรุงระบบอีเมล", body: "คืนวันเสาร์ 22:00–24:00", level: "warning", sort_order: 1 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "ปิดปรับปรุงระบบอีเมล", level: "warning", is_active: true, starts_on: null, sort_order: 1 });
    await it_.post("/api/v1/announcements").send({ title: "ด่วน", level: "danger", sort_order: 0, starts_on: localToday(), ends_on: localDay(2) });
    await it_.post("/api/v1/announcements").send({ title: "ยังไม่ถึงเวลา", level: "info", starts_on: localDay(3) });
    await it_.post("/api/v1/announcements").send({ title: "หมดเวลาแล้ว", level: "info", ends_on: localDay(-1) });
    await it_.post("/api/v1/announcements").send({ title: "ปิดไว้", level: "info", is_active: false });

    // ไม่ต้อง login
    const pub = await request(createApp()).get("/api/v1/announcements/public").set("Accept", "application/json");
    expect(pub.status).toBe(200);
    expect(pub.body.data.map((a: { title: string }) => a.title)).toEqual(["ด่วน", "ปิดปรับปรุงระบบอีเมล"]);
    expect(Object.keys(pub.body.data[0]).sort()).toEqual(["body", "ends_on", "id", "level", "starts_on", "title"]);

    expect((await it_.get("/api/v1/announcements")).body.data).toHaveLength(5);
    const id = created.body.data.id;
    const edited = await it_.put(`/api/v1/announcements/${id}`).send({ title: "เลื่อนปิดปรับปรุง", level: "info", is_active: false });
    expect(edited.body.data).toMatchObject({ title: "เลื่อนปิดปรับปรุง", is_active: false, body: null });
    expect((await it_.delete(`/api/v1/announcements/${id}`)).status).toBe(204);
    expect((await it_.delete(`/api/v1/announcements/${id}`)).status).toBe(404);
  });
});
