import { describe, expect, it } from "vitest";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeUser } from "./helpers.js";

/** จองรถ: คนขับรถ (ผู้จัดคิวเลือกเมื่อผู้จองขอ / ติดงาน = เลือกไม่ได้) + ผู้จัดคิวยกเลิกพร้อมเหตุผล */

async function seed() {
  const now = nowDb();
  await insert("dropdown_options", { list: "vehicle_purpose", name: "ใช้งานวันเดียว", is_active: true, sort_order: 0, created_at: now, updated_at: now }).catch(() => 0);
  return insert("vehicles", { name: `รถ ${crypto.randomUUID().slice(0, 6)}`, seats: 7, mileage: 1000, is_active: true, sort_order: 0, created_at: now, updated_at: now });
}
const booking = (extra: Record<string, unknown> = {}) => ({
  details: "ไปพบลูกค้า",
  passengers: 2,
  purpose: "ใช้งานวันเดียว",
  extras: [],
  start_on: day(2),
  start_time: "08:00",
  end_on: day(2),
  end_time: "17:00",
  ...extra,
});

describe("vehicle drivers", () => {
  it("dispatchers manage drivers; a booking that asks for a driver needs one on approval and a busy driver cannot be chosen", async () => {
    const vehicleId = await seed();
    const dispatcher = await as(await makeUser({ role: "admin" }));
    const booker = await makeUser();
    const api = await as(booker);

    // ผู้ใช้ทั่วไปเพิ่มคนขับไม่ได้
    expect((await api.post("/api/v1/vehicle-drivers").send({ name: "สมชาย ขับดี" })).status).toBe(403);
    const created = await dispatcher.post("/api/v1/vehicle-drivers").send({ name: "สมชาย ขับดี", nickname: "ชาย", branch_id: null });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: "สมชาย ขับดี", nickname: "ชาย", is_active: true });
    const driverId = created.body.data.id as number;

    // ขอคนขับ → อนุมัติต้องเลือกคนขับ
    const a = (await api.post("/api/v1/vehicle-bookings").send(booking({ needs_driver: true }))).body.data;
    expect(a).toMatchObject({ status: "pending", needs_driver: true, driver: null });
    expect((await dispatcher.post(`/api/v1/vehicle-bookings/${a.id}/approve`).send({ vehicle_id: vehicleId })).status).toBe(422);
    const approved = await dispatcher.post(`/api/v1/vehicle-bookings/${a.id}/approve`).send({ vehicle_id: vehicleId, driver_id: driverId });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: "confirmed", driver: { id: driverId, name: "สมชาย ขับดี" } });

    // การจองอื่นช่วงเวลาเดียวกัน: คนขับคนนี้ติดงาน (busy) + เลือกไม่ได้
    const b = (await api.post("/api/v1/vehicle-bookings").send(booking({ needs_driver: true, start_time: "10:00", end_time: "12:00" }))).body.data;
    const drivers = (await dispatcher.get(`/api/v1/vehicle-drivers?booking=${b.id}`)).body.data as { id: number; busy: boolean }[];
    expect(drivers.find((d) => d.id === driverId)?.busy).toBe(true);
    const vehicle2 = await seed();
    const clash = await dispatcher.post(`/api/v1/vehicle-bookings/${b.id}/approve`).send({ vehicle_id: vehicle2, driver_id: driverId });
    expect(clash.status).toBe(422);
    expect(Object.keys(clash.body.errors)).toContain("driver_id");

    // ไม่ขอคนขับ = อนุมัติได้โดยไม่มีคนขับ (คนขับที่ส่งมาไม่นับ)
    const c = (await api.post("/api/v1/vehicle-bookings").send(booking({ start_on: day(3), end_on: day(3) }))).body.data;
    const plain = await dispatcher.post(`/api/v1/vehicle-bookings/${c.id}/approve`).send({ vehicle_id: vehicleId, driver_id: driverId });
    expect(plain.body.data).toMatchObject({ status: "confirmed", needs_driver: false, driver: null });

    // ลบคนขับที่เคยถูกเลือกไม่ได้ (ปิดใช้งานแทน)
    expect((await dispatcher.delete(`/api/v1/vehicle-drivers/${driverId}`)).status).toBe(422);
    expect((await dispatcher.put(`/api/v1/vehicle-drivers/${driverId}`).send({ name: "สมชาย ขับดี", is_active: false })).body.data.is_active).toBe(false);
  });

  it("a dispatcher cancelling someone's booking must give a reason, and the booker is notified with it", async () => {
    const vehicleId = await seed();
    const dispatcher = await as(await makeUser({ role: "admin" }));
    const booker = await makeUser();
    const api = await as(booker);
    const a = (await api.post("/api/v1/vehicle-bookings").send(booking())).body.data;
    await dispatcher.post(`/api/v1/vehicle-bookings/${a.id}/approve`).send({ vehicle_id: vehicleId });

    expect((await dispatcher.post(`/api/v1/vehicle-bookings/${a.id}/cancel`).send({})).status).toBe(422);
    const cancelled = await dispatcher.post(`/api/v1/vehicle-bookings/${a.id}/cancel`).send({ reason: "รถเข้าศูนย์ซ่อม" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: "cancelled", cancel_reason: "รถเข้าศูนย์ซ่อม" });
    const notice = await first<{ data: string }>("SELECT data FROM notifications WHERE notifiable_id = ? AND data LIKE '%\"event\":\"cancelled\"%'", [booker.id]);
    expect(JSON.parse(notice!.data)).toMatchObject({ kind: "vehicle", reason: "รถเข้าศูนย์ซ่อม" });

    // ผู้จองยกเลิกเองไม่ต้องมีเหตุผล
    const b = (await api.post("/api/v1/vehicle-bookings").send(booking({ start_on: day(4), end_on: day(4) }))).body.data;
    expect((await api.post(`/api/v1/vehicle-bookings/${b.id}/cancel`).send({})).status).toBe(200);
    expect(Number(await scalar("SELECT COUNT(*) FROM vehicle_bookings WHERE uuid = ? AND cancel_reason IS NULL", [b.id]))).toBe(1);
  });
});
