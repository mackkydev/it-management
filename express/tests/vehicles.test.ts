import { describe, expect, it } from "vitest";
import { first, insert, scalar, select } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeUser, realImage } from "./helpers.js";

/** ตัวเลือกประเภทการใช้งาน / รายการเพิ่มเติม (ข้อมูล Drop Down) */
async function seedOptions() {
  const now = nowDb();
  for (const [list, name] of [["vehicle_purpose", "ใช้งานวันเดียว"], ["vehicle_purpose", "ออกต่างจังหวัดหลายวัน"], ["vehicle_extra", "น้ำมันเต็มถัง"], ["vehicle_extra", "Easy Pass"]]) {
    await insert("dropdown_options", { list, name, is_active: true, sort_order: 0, created_at: now, updated_at: now });
  }
}

async function makeVehicle(name = "รถตู้ 1", mileage: number | null = 10000): Promise<number> {
  const now = nowDb();
  return insert("vehicles", { name, seats: 10, mileage, is_active: true, sort_order: 0, created_at: now, updated_at: now });
}

const booking = (extra: Record<string, unknown> = {}) => ({
  vehicle_id: null,
  details: "ไปพบลูกค้าที่ชลบุรี",
  passengers: 3,
  purpose: "ใช้งานวันเดียว",
  extras: ["น้ำมันเต็มถัง"],
  start_on: day(1),
  start_time: "08:00",
  end_on: day(1),
  end_time: "17:00",
  ...extra,
});

describe("vehicles", () => {
  it("vehicle managers add vehicles with photos; the plate number is unique", async () => {
    const admin = await as(await makeUser({ role: "admin" }), "th");
    const viewer = await as(await makeUser());
    const body = { name: "รถตู้ VIP", plate_no: "1กข 1234", seats: 12, parking: "ลานจอด B1", mileage: 52000 };
    expect((await viewer.post("/api/v1/vehicles").send(body)).status).toBe(403);
    const created = await admin.post("/api/v1/vehicles").send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "รถตู้ VIP", plate_no: "1กข 1234", seats: 12, parking: "ลานจอด B1", mileage: 52000, images: [] });
    expect((await admin.post("/api/v1/vehicles").send({ ...body, name: "อีกคัน" })).status).toBe(422);
    const id = created.body.data.id;
    const up = await admin.post(`/api/v1/vehicles/${id}/images`).attach("images[0]", await realImage(800, 600, "jpg"), "car.jpg");
    expect(up.body.data.images).toEqual([{ id: expect.any(Number), is_primary: true }]);
    const img = up.body.data.images[0].id;
    expect((await viewer.get(`/api/v1/vehicles/${id}/images/${img}`)).headers["content-type"]).toContain("image/webp");
    expect((await admin.delete(`/api/v1/vehicles/${id}/images/${img}`)).body.data.images).toEqual([]);
    expect((await admin.delete(`/api/v1/vehicles/${id}`)).status).toBe(204);
  });

  it("unassigned bookings go to dispatchers; assigning picks up the latest mileage; overlaps are rejected; mileage updates the vehicle", async () => {
    await seedOptions();
    const van = await makeVehicle("รถตู้ 1", 10000);
    const pickup = await makeVehicle("กระบะ 1", 5000);
    const aliceUser = await makeUser({ name: "Alice", department: "ขาย" });
    const alice = await as(aliceUser, "th");
    const bob = await as(await makeUser({ name: "Bob" }), "th");
    const dispatcherUser = await makeUser({ role: "admin", name: "Dispatcher" });
    const dispatcher = await as(dispatcherUser, "th");

    // จองแบบไม่ระบุรถ → แจ้งผู้จัดคิวรถ + ตัวเลขเมนู
    const created = await alice.post("/api/v1/vehicle-bookings").send(booking());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ vehicle: null, user: { id: aliceUser.id }, department: "ขาย", extras: ["น้ำมันเต็มถัง"], start_mileage: null, can_assign: false });
    const uuid = created.body.data.id;
    const notice = await first<{ data: string }>("SELECT data FROM notifications WHERE notifiable_id = ? AND type = 'vehicle.requested'", [dispatcherUser.id]);
    expect(JSON.parse(notice!.data)).toMatchObject({ kind: "vehicle", event: "requested", vehicle_booking_id: uuid, actor: "Alice" });
    expect((await dispatcher.get("/api/v1/menu-badges")).body.data["/vehicles/dispatch"]).toBe(1);
    expect((await bob.get("/api/v1/menu-badges")).body.data["/vehicles/dispatch"]).toBeUndefined();
    expect((await bob.get("/api/v1/vehicle-bookings/dispatch")).status).toBe(403);
    expect((await dispatcher.get("/api/v1/vehicle-bookings/dispatch")).body.data.map((b: { id: string }) => b.id)).toEqual([uuid]);

    // ผู้จัดคิวเลือกรถ → เลขไมล์เริ่มต้น = เลขไมล์ล่าสุดของคัน, แจ้งเจ้าของ, แจ้งเตือนรอจัดรถหมดหน้าที่
    expect((await bob.put(`/api/v1/vehicle-bookings/${uuid}/vehicle`).send({ vehicle_id: van })).status).toBe(403);
    const assigned = await dispatcher.put(`/api/v1/vehicle-bookings/${uuid}/vehicle`).send({ vehicle_id: van });
    expect(assigned.body.data).toMatchObject({ vehicle: { id: van, name: "รถตู้ 1" }, start_mileage: 10000, assigned_by: "Dispatcher" });
    expect(await scalar("SELECT type FROM notifications WHERE notifiable_id = ? ORDER BY created_at DESC LIMIT 1", [aliceUser.id])).toBe("vehicle.assigned");
    expect(await scalar("SELECT read_at IS NOT NULL FROM notifications WHERE notifiable_id = ? AND type = 'vehicle.requested'", [dispatcherUser.id])).toBe(1);
    expect((await dispatcher.get("/api/v1/menu-badges")).body.data["/vehicles/dispatch"]).toBe(0);

    // รถคันเดียวกัน ช่วงหลายวันที่ซ้อน = 422 บอกผู้จอง / ต่อกันพอดี และคันอื่น = ได้
    const multi = { start_on: day(0), start_time: "23:00", end_on: day(1), end_time: "09:00", purpose: "ออกต่างจังหวัดหลายวัน" };
    const clash = await bob.post("/api/v1/vehicle-bookings").send(booking({ vehicle_id: van, ...multi }));
    expect(clash.status).toBe(422);
    expect(clash.body.errors.vehicle_id[0]).toContain("Alice");
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ vehicle_id: van, start_on: day(1), start_time: "17:00", end_on: day(2), end_time: "12:00" }))).status).toBe(201);
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ vehicle_id: pickup, ...multi }))).status).toBe(201);
    // ตรวจข้อมูล
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ end_time: "08:00" }))).status).toBe(422);
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ start_on: day(-2), end_on: day(-1) }))).status).toBe(422);
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ purpose: "เที่ยว" }))).status).toBe(422);
    expect((await bob.post("/api/v1/vehicle-bookings").send(booking({ extras: ["คนขับ"] }))).status).toBe(422);
    expect((await bob.put(`/api/v1/vehicle-bookings/${uuid}`).send(booking())).status).toBe(403);

    // เจ้าของบันทึกเลขไมล์สิ้นสุด → เลขไมล์ล่าสุดของคันขยับ, จองคันนี้ครั้งต่อไปได้เลขไมล์ใหม่เป็นค่าเริ่มต้น
    expect((await alice.put(`/api/v1/vehicle-bookings/${uuid}/mileage`).send({ start_mileage: 10000, end_mileage: 9000 })).status).toBe(422);
    expect((await alice.put(`/api/v1/vehicle-bookings/${uuid}/mileage`).send({ start_mileage: 10000, end_mileage: 10250 })).body.data.end_mileage).toBe(10250);
    expect(await scalar("SELECT mileage FROM vehicles WHERE id = ?", [van])).toBe(10250);
    const next = await bob.post("/api/v1/vehicle-bookings").send(booking({ vehicle_id: van, start_on: day(3), end_on: day(3) }));
    expect(next.body.data.start_mileage).toBe(10250);
    const history = (await dispatcher.get(`/api/v1/vehicles/${van}/mileage`)).body.data;
    expect(history.find((h: { booking_id: string }) => h.booking_id === uuid)).toMatchObject({ start_mileage: 10000, end_mileage: 10250, distance: 250, user_name: "Alice" });

    // ปฏิทิน: การจองหลายวันขึ้นทุกวันในช่วง
    const range = (await bob.get(`/api/v1/vehicle-bookings?from=${day(0)}&to=${day(0)}`)).body.data;
    expect(range).toHaveLength(1);
    // ผู้จัดคิวแก้การจองของคนอื่นได้ → แจ้งเจ้าของ
    expect((await dispatcher.put(`/api/v1/vehicle-bookings/${uuid}`).send(booking({ vehicle_id: van, passengers: 5 }))).body.data.passengers).toBe(5);
    // ยกเลิก → ช่วงเวลาว่าง / ลบ → หายจากรายการ
    expect((await alice.post(`/api/v1/vehicle-bookings/${uuid}/cancel`)).body.data.status).toBe("cancelled");
    expect((await alice.get("/api/v1/vehicle-bookings/mine?status=cancelled")).body.data.map((b: { id: string }) => b.id)).toEqual([uuid]);
    expect((await alice.delete(`/api/v1/vehicle-bookings/${uuid}`)).status).toBe(204);
    expect((await alice.get(`/api/v1/vehicle-bookings/${uuid}`)).status).toBe(404);
    expect((await dispatcher.delete(`/api/v1/vehicles/${van}`)).status).toBe(422);
    const actions = (await select<{ action: string }>("SELECT action FROM audit_logs WHERE action LIKE 'vehicle_booking.%'")).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["vehicle_booking.created", "vehicle_booking.assigned", "vehicle_booking.mileage", "vehicle_booking.updated", "vehicle_booking.cancelled", "vehicle_booking.deleted"]));
  });

  it("finished trips stay as history but mileage can still be recorded; options are managed with vehicle.manage", async () => {
    await seedOptions();
    const van = await makeVehicle("รถตู้ 2", 300);
    const user = await makeUser();
    const api = await as(user);
    const admin = await as(await makeUser({ role: "admin" }));
    const viewer = await as(await makeUser());
    const now = nowDb();
    const id = await insert("vehicle_bookings", {
      uuid: "21111111-2222-4333-8444-555555555555", vehicle_id: van, user_id: user.id, details: "เมื่อวาน", passengers: 2, purpose: "ใช้งานวันเดียว",
      start_on: day(-2), start_time: "08:00", end_on: day(-1), end_time: "18:00", start_mileage: 300, status: "confirmed", created_at: now, updated_at: now,
    });
    await insert("vehicle_booking_extras", { booking_id: id, name: "Easy Pass" });
    const past = (await api.get("/api/v1/vehicle-bookings/mine?status=past")).body.data;
    expect(past[0]).toMatchObject({ is_over: true, can_edit: false, can_cancel: false, can_delete: false, can_mileage: true });
    expect((await api.put(`/api/v1/vehicle-bookings/${past[0].id}`).send(booking({ vehicle_id: van }))).status).toBe(422);
    expect((await api.put(`/api/v1/vehicle-bookings/${past[0].id}/mileage`).send({ start_mileage: 300, end_mileage: 420 })).status).toBe(200);
    expect(await scalar("SELECT mileage FROM vehicles WHERE id = ?", [van])).toBe(420);

    expect((await viewer.post("/api/v1/dropdown-options/vehicle_extra").send({ name: "คนขับ" })).status).toBe(403);
    const easy = (await admin.get("/api/v1/dropdown-options/vehicle_extra?include_inactive=1")).body.data.find((o: { name: string }) => o.name === "Easy Pass");
    expect(easy.usage_count).toBe(1);
    expect((await admin.put(`/api/v1/dropdown-options/vehicle_extra/${easy.id}`).send({ name: "Easy Pass / M-Flow" })).status).toBe(200);
    expect(await scalar("SELECT name FROM vehicle_booking_extras WHERE booking_id = ?", [id])).toBe("Easy Pass / M-Flow");
  });
});
