import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { localToday } from "../src/lib/time.js";
import { as, localDay, makeUser, realImage } from "./helpers.js";

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

  it("repeats on matching days only, inside the date range", async () => {
    const it_ = await as(await makeUser({ is_it_staff: true }));
    const today = localDay(0);
    const [y, m, d] = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const otherDay = d === 1 ? 2 : 1;
    const otherMonth = m === 1 ? 2 : 1;
    const add = (title: string, extra: Record<string, unknown>) => it_.post("/api/v1/announcements").send({ title, level: "info", ...extra });
    const titles = async () => (await request(createApp()).get("/api/v1/announcements/public").set("Accept", "application/json")).body.data.map((a: { title: string }) => a.title);

    // บังคับค่าตามรูปแบบ / กันวันที่ไม่มีจริง
    expect((await add("x", { repeat_mode: "weekly" })).body.errors.repeat_weekday).toBeTruthy();
    expect((await add("x", { repeat_mode: "monthly" })).body.errors.repeat_day).toBeTruthy();
    expect(Object.keys((await add("x", { repeat_mode: "yearly" })).body.errors).sort()).toEqual(["repeat_day", "repeat_month"]);
    expect((await add("x", { repeat_mode: "yearly", repeat_day: 31, repeat_month: 4 })).body.errors.repeat_day).toBeTruthy();

    await add("r-daily", { repeat_mode: "daily" });
    const week = await add("r-week", { repeat_mode: "weekly", repeat_weekday: weekday, repeat_day: 9 });
    expect(week.body.data).toMatchObject({ repeat_mode: "weekly", repeat_weekday: weekday, repeat_day: null, is_showing: true });
    await add("r-month", { repeat_mode: "monthly", repeat_day: d });
    await add("r-year", { repeat_mode: "yearly", repeat_day: d, repeat_month: m });
    const later = await add("x-week", { repeat_mode: "weekly", repeat_weekday: (weekday + 1) % 7 });
    expect(later.body.data.is_showing).toBe(false);
    await add("x-month", { repeat_mode: "monthly", repeat_day: otherDay });
    await add("x-year", { repeat_mode: "yearly", repeat_day: d > 28 ? 28 : d, repeat_month: otherMonth });
    await add("x-ended", { repeat_mode: "daily", ends_on: localDay(-1) });

    const shown = await titles();
    expect([...shown].sort()).toEqual(["r-daily", "r-month", "r-week", "r-year"]);
  });

  it("cover and documents: uploaded, replaced, visible to signed-in users only while showing", async () => {
    const manager = await as(await makeUser({ is_it_staff: true }));
    const viewer = await as(await makeUser());
    const field = <T extends { field: (k: string, v: string) => T }>(req: T, fields: Record<string, string>) => {
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };
    const form = { title: "มีไฟล์", level: "info", is_active: "1", starts_on: "", ends_on: "", sort_order: "0", repeat_mode: "none", repeat_weekday: "", repeat_day: "", repeat_month: "" };

    expect((await field(manager.post("/api/v1/announcements"), form).attach("cover", Buffer.from("not an image"), "x.png")).status).toBe(422);

    const created = await field(manager.post("/api/v1/announcements"), form).attach("cover", await realImage(800, 300, "png"), "cover.png").attach("files[]", await realImage(800, 300, "png"), "doc.png");
    expect(created.status).toBe(201);
    const { id, cover_url, files } = created.body.data as { id: number; cover_url: string; files: { id: number; name: string; url: string }[] };
    expect(files.map((f) => f.name)).toEqual(["doc.png"]);

    // ไม่ login = ไม่เห็นข้อมูลไฟล์ / login แล้วดูได้
    const pub = await request(createApp()).get("/api/v1/announcements/public").set("Accept", "application/json");
    expect(pub.body.data.find((a: { id: number }) => a.id === id)).not.toHaveProperty("cover_url");
    expect((await request(createApp()).get(`/api/v1${cover_url}`).set("Accept", "application/json")).status).toBe(401);
    expect((await viewer.get("/api/v1/announcements/feed")).body.data.find((a: { id: number }) => a.id === id).cover_url).toBe(cover_url);
    const img = await viewer.get(`/api/v1${cover_url}`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toContain("image/webp");
    expect((await viewer.get(`/api/v1${files[0].url}`)).status).toBe(200);

    // เปลี่ยนรูปหน้าปก + ลบเอกสาร (ส่ง multipart ค่าเดิม)
    const replaced = await field(manager.put(`/api/v1/announcements/${id}`), { ...form, "remove_file_ids[]": String(files[0].id) }).attach("cover", await realImage(800, 300, "png"), "new.png");
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.cover_url).not.toBe(cover_url);
    expect(replaced.body.data.files).toEqual([]);
    expect((await viewer.get(`/api/v1${cover_url}`)).status).toBe(404);

    // ปิดประกาศ = คนทั่วไปเปิดไฟล์ไม่ได้ ผู้จัดการยังเปิดได้ / ไม่ส่งรูปใหม่ = รูปเดิมคงอยู่
    const closed = await field(manager.put(`/api/v1/announcements/${id}`), { ...form, is_active: "0" });
    expect(closed.body.data.cover_url).toBe(replaced.body.data.cover_url);
    expect((await viewer.get(`/api/v1${closed.body.data.cover_url}`)).status).toBe(404);
    expect((await manager.get(`/api/v1${closed.body.data.cover_url}`)).status).toBe(200);
    const removed = await field(manager.put(`/api/v1/announcements/${id}`), { ...form, remove_cover: "1" });
    expect(removed.body.data.cover_url).toBeNull();
  });

  it("past announcements stay readable with their files, but not hidden or upcoming ones", async () => {
    const manager = await as(await makeUser({ is_it_staff: true }));
    const viewer = await as(await makeUser());
    const add = (title: string, fields: Record<string, string>) => {
      let req = manager.post("/api/v1/announcements");
      for (const [k, v] of Object.entries({ title, level: "info", is_active: "1", ...fields })) req = req.field(k, v);
      return req;
    };

    const ended = await add("past-ended", { body: "รายละเอียดเดิม", ends_on: localDay(-1) }).attach("cover", await realImage(800, 300, "png"), "cover.png").attach("files[]", await realImage(800, 300, "png"), "doc.png");
    const older = await add("past-older", { ends_on: localDay(-30) });
    const hidden = await add("past-hidden", { is_active: "0", ends_on: localDay(-1) }).attach("cover", await realImage(800, 300, "png"), "cover.png");
    const upcoming = await add("past-upcoming", { starts_on: localDay(3) }).attach("cover", await realImage(800, 300, "png"), "cover.png");
    await add("past-today", { ends_on: localDay(0) });

    expect((await request(createApp()).get("/api/v1/announcements/past").set("Accept", "application/json")).status).toBe(401);

    const past = (await viewer.get("/api/v1/announcements/past")).body.data as { id: number; title: string; body: string | null; cover_url: string | null; files: { url: string }[] }[];
    const titles = past.map((a) => a.title).filter((title) => title.startsWith("past-"));
    expect(titles).toEqual(["past-ended", "past-older"]);
    const item = past.find((a) => a.id === ended.body.data.id)!;
    expect(item.body).toBe("รายละเอียดเดิม");
    expect((await viewer.get(`/api/v1${item.cover_url}`)).status).toBe(200);
    expect((await viewer.get(`/api/v1${item.files[0].url}`)).status).toBe(200);
    expect(past.find((a) => a.id === older.body.data.id)).toMatchObject({ cover_url: null, files: [] });

    // ปิดไว้ / ยังไม่ถึงเวลา = คนทั่วไปเปิดไฟล์ไม่ได้ ผู้จัดการยังเปิดได้
    for (const row of [hidden, upcoming]) {
      expect((await viewer.get(`/api/v1${row.body.data.cover_url}`)).status).toBe(404);
      expect((await manager.get(`/api/v1${row.body.data.cover_url}`)).status).toBe(200);
    }
  });
});
