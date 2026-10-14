import { describe, expect, it } from "vitest";
import { first, insert, scalar, select } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, fakeImage, makeUser, realImage } from "./helpers.js";

/** ตัวเลือกประเภทการใช้งาน / อุปกรณ์ (ข้อมูล Drop Down) */
async function seedOptions() {
  const now = nowDb();
  for (const [list, name] of [["meeting_purpose", "ประชุม"], ["meeting_purpose", "อบรม"], ["meeting_equipment", "โปรเจคเตอร์"], ["meeting_equipment", "Zoom Meeting"]]) {
    await insert("dropdown_options", { list, name, is_active: true, sort_order: 0, created_at: now, updated_at: now });
  }
}

async function makeRoom(name = "ห้องประชุม 1", seats = [{ label: "ที่นั่งหลัก", count: 10 }]): Promise<number> {
  const now = nowDb();
  return insert("meeting_rooms", { name, seats: JSON.stringify(seats), is_active: true, sort_order: 0, created_at: now, updated_at: now });
}

const booking = (room: number, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  room_id: room,
  title: "ประชุมประจำสัปดาห์",
  attendees: 6,
  purpose: "ประชุม",
  equipment: ["โปรเจคเตอร์"],
  date: day(1),
  start_time: start,
  end_time: end,
  ...extra,
});

describe("meeting rooms", () => {
  it("room managers add rooms with seating rows and up to 4 photos (one primary)", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const viewer = await as(await makeUser());
    const body = { name: "ห้องประชุมใหญ่", location: "อาคาร A ชั้น 3", room_no: "A-301", seats: [{ label: "ที่นั่งหลัก", count: 20 }, { label: "ที่นั่งสำรอง", count: 5 }] };
    expect((await viewer.post("/api/v1/meeting-rooms").send(body)).status).toBe(403);
    const created = await admin.post("/api/v1/meeting-rooms").send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "ห้องประชุมใหญ่", room_no: "A-301", capacity: 25, seats: body.seats, images: [] });
    const id = created.body.data.id;
    expect((await admin.post("/api/v1/meeting-rooms").send({ ...body, name: "ห้องประชุมใหญ่" })).status).toBe(422);
    expect((await admin.post("/api/v1/meeting-rooms").send({ ...body, name: "B", seats: [{ label: "", count: 3 }] })).status).toBe(422);
    expect((await admin.post("/api/v1/meeting-rooms").send({ ...body, name: "C", seats: [] })).status).toBe(422);

    // รูป: ≤ 1MB, ≤ 4 รูป — รูปแรกเป็นรูปหลัก
    const big = await admin.post(`/api/v1/meeting-rooms/${id}/images`).attach("images[0]", fakeImage(1100, "jpg"), "big.jpg");
    expect(big.status).toBe(422);
    const two = await admin
      .post(`/api/v1/meeting-rooms/${id}/images`)
      .attach("images[0]", await realImage(800, 600, "jpg"), "a.jpg")
      .attach("images[1]", await realImage(400, 300, "png"), "b.png");
    expect(two.status).toBe(201);
    const imgs = two.body.data.images as { id: number; is_primary: boolean }[];
    expect(imgs.map((i) => i.is_primary)).toEqual([true, false]);
    const tooMany = await admin
      .post(`/api/v1/meeting-rooms/${id}/images`)
      .attach("images[0]", await realImage(400, 300, "jpg"), "c.jpg")
      .attach("images[1]", await realImage(400, 300, "jpg"), "d.jpg")
      .attach("images[2]", await realImage(400, 300, "jpg"), "e.jpg");
    expect(tooMany.status).toBe(422);

    // ตั้งรูปที่ 2 เป็นรูปหลัก → ลบรูปหลัก → รูปที่เหลือเป็นรูปหลักแทน
    expect((await admin.put(`/api/v1/meeting-rooms/${id}/images/${imgs[1].id}`)).body.data.images.find((i: { is_primary: boolean }) => i.is_primary).id).toBe(imgs[1].id);
    const afterDelete = await admin.delete(`/api/v1/meeting-rooms/${id}/images/${imgs[1].id}`);
    expect(afterDelete.body.data.images).toEqual([{ id: imgs[0].id, is_primary: true }]);
    // ทุกคนเปิดดูรูปได้ (ไฟล์ WebP ที่ประมวลผลใหม่)
    const file = await viewer.get(`/api/v1/meeting-rooms/${id}/images/${imgs[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("image/webp");
    expect((await viewer.put(`/api/v1/meeting-rooms/${id}/images/${imgs[0].id}`)).status).toBe(403);

    // ปิดใช้งาน → ไม่แสดงในรายการของผู้ใช้
    await admin.put(`/api/v1/meeting-rooms/${id}`).send({ ...body, is_active: false });
    expect((await viewer.get("/api/v1/meeting-rooms")).body.data).toEqual([]);
    expect((await viewer.get("/api/v1/meeting-rooms?include_inactive=1")).status).toBe(403);
    expect((await admin.get("/api/v1/meeting-rooms?include_inactive=1")).body.data).toHaveLength(1);
    // ไม่มีการจอง = ลบได้
    expect((await admin.delete(`/api/v1/meeting-rooms/${id}`)).status).toBe(204);
    expect(await scalar("SELECT COUNT(*) FROM meeting_room_images")).toBe(0);
  });

  it("bookings: no overlapping room/time, owner manages own, manage_any edits others with a notice", async () => {
    await seedOptions();
    const room1 = await makeRoom("ห้อง 1");
    const room2 = await makeRoom("ห้อง 2");
    const aliceUser = await makeUser({ name: "Alice", department: "บัญชี" });
    const alice = await as(aliceUser, "th");
    const bob = await as(await makeUser({ name: "Bob" }), "th");
    const admin = await as(await makeUser({ role: "admin", name: "Admin" }), "th");

    const created = await alice.post("/api/v1/meeting-bookings").send(booking(room1, "09:00", "10:30"));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ user: { id: aliceUser.id, name: "Alice" }, department: "บัญชี", equipment: ["โปรเจคเตอร์"], status: "confirmed", can_edit: true });
    const uuid = created.body.data.id;

    // ห้องเดียวกัน ช่วงเวลาซ้อน = 422 พร้อมบอกว่าใครจองไว้
    const clash = await bob.post("/api/v1/meeting-bookings").send(booking(room1, "10:00", "11:00"));
    expect(clash.status).toBe(422);
    expect(clash.body.errors.start_time[0]).toContain("09:00–10:30");
    expect(clash.body.errors.start_time[0]).toContain("Alice");
    // ต่อกันพอดี / ห้องอื่นเวลาเดียวกัน = ได้
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room1, "10:30", "11:00"))).status).toBe(201);
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room2, "09:00", "10:00"))).status).toBe(201);
    // ตรวจข้อมูล
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room2, "11:00", "11:00"))).status).toBe(422);
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room2, "11:00", "12:00", { date: day(-1) }))).status).toBe(422);
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room2, "11:00", "12:00", { purpose: "ปาร์ตี้" }))).status).toBe(422);
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room2, "11:00", "12:00", { equipment: ["ไมค์"] }))).status).toBe(422);

    // คนอื่นแก้/ยกเลิก/ลบไม่ได้
    expect((await bob.put(`/api/v1/meeting-bookings/${uuid}`).send(booking(room1, "08:00", "09:00"))).status).toBe(403);
    expect((await bob.post(`/api/v1/meeting-bookings/${uuid}/cancel`)).status).toBe(403);
    expect((await bob.delete(`/api/v1/meeting-bookings/${uuid}`)).status).toBe(403);
    // ผู้มีสิทธิ์ meeting.manage_any แก้ได้ → แจ้งเตือนเจ้าของ
    const moved = await admin.put(`/api/v1/meeting-bookings/${uuid}`).send(booking(room1, "13:00", "14:00", { equipment: ["Zoom Meeting", "โปรเจคเตอร์"] }));
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ start_time: "13:00", end_time: "14:00", equipment: ["Zoom Meeting", "โปรเจคเตอร์"], user: { id: aliceUser.id } });
    const notice = await first<{ type: string; data: string }>("SELECT type, data FROM notifications WHERE notifiable_id = ?", [aliceUser.id]);
    expect(notice?.type).toBe("meeting.updated");
    expect(JSON.parse(notice!.data)).toMatchObject({ kind: "meeting", event: "updated", actor: "Admin", booking_id: uuid });

    // ช่วงเดิม 09:00–10:00 ว่างแล้ว
    expect((await bob.post("/api/v1/meeting-bookings").send(booking(room1, "09:00", "10:00"))).status).toBe(201);

    // ปฏิทิน: เฉพาะที่ยืนยันแล้ว
    const range = await bob.get(`/api/v1/meeting-bookings?from=${day(0)}&to=${day(7)}`);
    expect(range.body.data).toHaveLength(4);
    expect(range.body.data.find((b: { id: string }) => b.id === uuid).can_edit).toBe(false);

    // เจ้าของยกเลิก → ไปอยู่แท็บยกเลิก, ช่วงเวลาว่าง
    expect((await alice.post(`/api/v1/meeting-bookings/${uuid}/cancel`)).body.data.status).toBe("cancelled");
    expect((await alice.put(`/api/v1/meeting-bookings/${uuid}`).send(booking(room1, "15:00", "16:00"))).status).toBe(422);
    expect((await alice.get("/api/v1/meeting-bookings/mine?status=cancelled")).body.data.map((b: { id: string }) => b.id)).toEqual([uuid]);
    expect((await alice.get("/api/v1/meeting-bookings/mine")).body.data).toEqual([]);
    expect((await bob.get(`/api/v1/meeting-bookings?from=${day(0)}&to=${day(7)}`)).body.data).toHaveLength(3);
    // ลบ (soft delete) → หายจากทุกรายการ
    expect((await alice.delete(`/api/v1/meeting-bookings/${uuid}`)).status).toBe(204);
    expect((await alice.get("/api/v1/meeting-bookings/mine?status=cancelled")).body.data).toEqual([]);
    expect((await alice.get(`/api/v1/meeting-bookings/${uuid}`)).status).toBe(404);
    expect(await scalar("SELECT COUNT(*) FROM meeting_bookings WHERE deleted_at IS NOT NULL")).toBe(1);

    // ห้องที่มีประวัติการจอง ลบไม่ได้
    expect((await admin.delete(`/api/v1/meeting-rooms/${room1}`)).status).toBe(422);
    const actions = (await select<{ action: string }>("SELECT action FROM audit_logs WHERE action LIKE 'meeting_booking.%' ORDER BY id")).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["meeting_booking.created", "meeting_booking.updated", "meeting_booking.cancelled", "meeting_booking.deleted"]));
  });

  it("past bookings stay as history; usage-type / equipment options are managed with meeting.rooms and renames follow", async () => {
    await seedOptions();
    const room = await makeRoom();
    const user = await makeUser();
    const api = await as(user);
    const admin = await as(await makeUser({ role: "admin" }));
    const viewer = await as(await makeUser());
    // การจองเมื่อวาน (ข้อมูลเดิม) — แก้/ยกเลิก/ลบไม่ได้, อยู่แท็บ "ผ่านไปแล้ว"
    const now = nowDb();
    const pastId = await insert("meeting_bookings", {
      uuid: "11111111-2222-4333-8444-555555555555", room_id: room, user_id: user.id, title: "เมื่อวาน", attendees: 3, purpose: "ประชุม",
      booking_date: day(-1), start_time: "09:00", end_time: "10:00", status: "confirmed", created_at: now, updated_at: now,
    });
    await insert("meeting_booking_equipment", { booking_id: pastId, name: "โปรเจคเตอร์" });
    const past = (await api.get("/api/v1/meeting-bookings/mine?status=past")).body.data;
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({ is_over: true, can_edit: false, can_cancel: false, can_delete: false });
    expect((await api.delete(`/api/v1/meeting-bookings/${past[0].id}`)).status).toBe(422);
    expect((await api.post(`/api/v1/meeting-bookings/${past[0].id}/cancel`)).status).toBe(422);

    // ตัวเลือก: viewer เห็นรายการ แต่จัดการไม่ได้, ผู้ดูแล (meeting.rooms) เปลี่ยนชื่อ → การจองเดิมเปลี่ยนตาม
    expect((await viewer.get("/api/v1/dropdown-options/meeting_equipment")).body.data).toHaveLength(2);
    expect((await viewer.post("/api/v1/dropdown-options/meeting_equipment").send({ name: "ไมค์" })).status).toBe(403);
    const list = (await admin.get("/api/v1/dropdown-options/meeting_equipment?include_inactive=1")).body.data;
    const projector = list.find((o: { name: string }) => o.name === "โปรเจคเตอร์");
    expect(projector.usage_count).toBe(1);
    expect((await admin.put(`/api/v1/dropdown-options/meeting_equipment/${projector.id}`).send({ name: "จอ + โปรเจคเตอร์" })).status).toBe(200);
    expect(await scalar("SELECT name FROM meeting_booking_equipment WHERE booking_id = ?", [pastId])).toBe("จอ + โปรเจคเตอร์");
    const purpose = (await admin.get("/api/v1/dropdown-options/meeting_purpose?include_inactive=1")).body.data.find((o: { name: string }) => o.name === "ประชุม");
    expect(purpose.usage_count).toBe(1);
    expect((await admin.delete(`/api/v1/dropdown-options/meeting_purpose/${purpose.id}`)).status).toBe(422);
  });
});
