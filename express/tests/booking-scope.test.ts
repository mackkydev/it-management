import { describe, expect, it } from "vitest";
import { insert, scalar, select } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeBranch, makeUser } from "./helpers.js";

/** ห้องประชุม / รถ ตามสาขา — ขอบเขตต่อกลุ่มสิทธิ์ (booking_scope) + ย้ายรถข้ามสาขา */

async function seedOptions() {
  const now = nowDb();
  for (const [list, name] of [["meeting_purpose", "ประชุม"], ["vehicle_purpose", "ใช้งานวันเดียว"]]) {
    await insert("dropdown_options", { list, name, is_active: true, sort_order: 0, created_at: now, updated_at: now });
  }
}

const room = (branch_id: number | null, name: string) => ({ name, branch_id, seats: [{ label: "ที่นั่งหลัก", count: 10 }] });
const meeting = (room_id: number) => ({ room_id, title: "ประชุมทีม", attendees: 5, purpose: "ประชุม", date: day(1), start_time: "09:00", end_time: "10:00" });
const trip = (extra: Record<string, unknown> = {}) => ({
  vehicle_id: null, details: "ไปพบลูกค้า", passengers: 2, purpose: "ใช้งานวันเดียว", start_on: day(1), start_time: "08:00", end_on: day(1), end_time: "17:00", ...extra,
});
const ids = (res: { body: { data: { id: number | string }[] } }) => res.body.data.map((x) => x.id);

async function setup() {
  await seedOptions();
  const A = await makeBranch({ name: "สาขา A" });
  const B = await makeBranch({ name: "สาขา B" });
  const root = await as(await makeUser({ role: "super_admin" }), "th");
  const adminAUser = await makeUser({ role: "admin", branch_id: A, name: "Admin A" });
  const adminBUser = await makeUser({ role: "admin", branch_id: B, name: "Admin B" });
  const viewerAUser = await makeUser({ branch_id: A, name: "Viewer A" });
  const viewerBUser = await makeUser({ branch_id: B, name: "Viewer B" });
  return {
    A, B, root, adminAUser, adminBUser, viewerAUser, viewerBUser,
    adminA: await as(adminAUser, "th"), adminB: await as(adminBUser, "th"), viewerA: await as(viewerAUser, "th"), viewerB: await as(viewerBUser, "th"),
  };
}

describe("booking scope by branch", () => {
  it("only access.manage sets the scope per group; groups not set see every branch", async () => {
    const { root, adminA, viewerA } = await setup();
    expect((await viewerA.get("/api/v1/booking-scope/me?kind=vehicle")).body.data).toMatchObject({ scope: "all" });
    const body = { meeting: { viewer: "branch", admin: "branch" }, vehicle: { viewer: "branch" } };
    expect((await adminA.put("/api/v1/booking-scope").send(body)).status).toBe(403);
    expect((await root.put("/api/v1/booking-scope").send({ meeting: { viewer: "nowhere" } })).status).toBe(422);
    expect((await root.put("/api/v1/booking-scope").send({ meeting: { no_such_group: "branch" } })).status).toBe(422);
    const saved = await root.put("/api/v1/booking-scope").send(body);
    expect(saved.status).toBe(200);
    expect((await root.get("/api/v1/booking-scope")).body.data).toEqual(body);
    expect((await viewerA.get("/api/v1/booking-scope/me?kind=meeting")).body.data).toMatchObject({ scope: "branch", branches: [] });
    expect((await viewerA.get("/api/v1/booking-scope/me?kind=vehicle")).body.data.scope).toBe("branch");
    expect((await adminA.get("/api/v1/booking-scope/me?kind=vehicle")).body.data.scope).toBe("all");
    expect((await root.get("/api/v1/booking-scope/me?kind=meeting")).body.data.branches.length).toBeGreaterThanOrEqual(2);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'booking_scope.updated'")).toBe(1);
  });

  it("meeting rooms: branch scope sees own branch + shared rooms, books only those, manages only own branch", async () => {
    const { A, B, root, adminA, viewerA, viewerB } = await setup();
    await root.put("/api/v1/booking-scope").send({ meeting: { viewer: "branch", admin: "branch" } });

    // ผู้จัดการห้องสาขา A เพิ่มได้เฉพาะสาขา A (ห้องใช้ร่วมกัน = ขอบเขตทุกสาขาเท่านั้น)
    expect((await adminA.post("/api/v1/meeting-rooms").send(room(B, "ห้อง B โดย A"))).status).toBe(422);
    expect((await adminA.post("/api/v1/meeting-rooms").send(room(null, "ห้องกลางโดย A"))).status).toBe(422);
    const roomA = (await adminA.post("/api/v1/meeting-rooms").send(room(A, "ห้อง A"))).body.data;
    expect(roomA).toMatchObject({ branch: { id: A }, can_manage: true });
    const roomB = (await root.post("/api/v1/meeting-rooms").send(room(B, "ห้อง B"))).body.data;
    const shared = (await root.post("/api/v1/meeting-rooms").send(room(null, "ห้องกลาง"))).body.data;

    expect(ids(await viewerA.get("/api/v1/meeting-rooms")).sort()).toEqual([roomA.id, shared.id].sort());
    expect(ids(await viewerB.get("/api/v1/meeting-rooms")).sort()).toEqual([roomB.id, shared.id].sort());
    expect(ids(await root.get(`/api/v1/meeting-rooms?branch_id=${B}`)).sort()).toEqual([roomB.id, shared.id].sort());
    expect((await viewerA.get(`/api/v1/meeting-rooms/${roomB.id}`)).status).toBe(404);

    // จองได้เฉพาะห้องที่เห็น — ห้องกลางทุกคนจองได้และเห็นการจองของกันและกัน
    expect((await viewerA.post("/api/v1/meeting-bookings").send(meeting(roomB.id))).status).toBe(422);
    const bookedB = await viewerB.post("/api/v1/meeting-bookings").send(meeting(roomB.id));
    expect(bookedB.status).toBe(201);
    expect((await viewerA.get(`/api/v1/meeting-bookings/${bookedB.body.data.id}`)).status).toBe(404);
    const sharedBooking = await viewerB.post("/api/v1/meeting-bookings").send({ ...meeting(shared.id), start_time: "13:00", end_time: "14:00" });
    const listA = await viewerA.get(`/api/v1/meeting-bookings?from=${day(0)}&to=${day(2)}`);
    expect(ids(listA)).toEqual([sharedBooking.body.data.id]);

    // ผู้จัดการห้องสาขา A แก้ห้อง/การจองของสาขา B และห้องกลางไม่ได้
    expect((await adminA.put(`/api/v1/meeting-rooms/${roomB.id}`).send(room(B, "ห้อง B"))).status).toBe(404);
    expect((await adminA.put(`/api/v1/meeting-rooms/${shared.id}`).send(room(null, "ห้องกลาง"))).status).toBe(403);
    expect((await adminA.post(`/api/v1/meeting-bookings/${sharedBooking.body.data.id}/cancel`)).status).toBe(403);
    expect((await root.post(`/api/v1/meeting-bookings/${sharedBooking.body.data.id}/cancel`)).status).toBe(200);
  });

  it("vehicles: unassigned requests go to the dispatchers of that branch; vehicles move between branches with history", async () => {
    const { A, B, root, adminA, adminB, adminAUser, adminBUser, viewerA, viewerB } = await setup();
    await root.put("/api/v1/booking-scope").send({ vehicle: { viewer: "branch", admin: "branch" } });

    const vanA = (await adminA.post("/api/v1/vehicles").send({ name: "รถตู้ A", seats: 10, branch_id: A })).body.data;
    expect(vanA.can_manage).toBe(true);
    expect((await adminA.post("/api/v1/vehicles").send({ name: "รถตู้ B?", seats: 10, branch_id: B })).status).toBe(422);
    const vanB = (await root.post("/api/v1/vehicles").send({ name: "รถตู้ B", seats: 10, branch_id: B })).body.data;
    expect(ids(await viewerA.get("/api/v1/vehicles"))).toEqual([vanA.id]);

    // ไม่ระบุรถ → สาขาของผู้จอง → ผู้จัดคิวสาขา B เท่านั้นได้แจ้งเตือน/ตัวเลขเมนู/รายการ
    expect((await viewerB.post("/api/v1/vehicle-bookings").send(trip({ branch_id: A }))).status).toBe(422);
    expect((await viewerB.post("/api/v1/vehicle-bookings").send(trip({ vehicle_id: vanA.id }))).status).toBe(422);
    const req = await viewerB.post("/api/v1/vehicle-bookings").send(trip());
    expect(req.status).toBe(201);
    expect(req.body.data.branch).toMatchObject({ id: B });
    const uuid = req.body.data.id;
    const notified = async (id: number) => Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = 'vehicle.requested'", [id]));
    expect(await notified(adminBUser.id)).toBe(1);
    expect(await notified(adminAUser.id)).toBe(0);
    expect((await adminB.get("/api/v1/menu-badges")).body.data["/vehicles/dispatch"]).toBe(1);
    expect((await adminA.get("/api/v1/menu-badges")).body.data["/vehicles/dispatch"]).toBe(0);
    expect(ids(await adminA.get("/api/v1/vehicle-bookings/dispatch"))).toEqual([]);
    expect((await adminA.put(`/api/v1/vehicle-bookings/${uuid}/vehicle`).send({ vehicle_id: vanA.id })).status).toBe(404);
    expect((await adminB.put(`/api/v1/vehicle-bookings/${uuid}/vehicle`).send({ vehicle_id: vanA.id })).status).toBe(422);
    expect((await adminB.put(`/api/v1/vehicle-bookings/${uuid}/vehicle`).send({ vehicle_id: vanB.id })).body.data.vehicle).toMatchObject({ id: vanB.id });

    // แก้สาขาที่หน้าแก้ไขไม่ได้ — ต้องย้ายสาขา (เก็บประวัติ)
    const edit = { name: "รถตู้ A", seats: 10 };
    expect((await adminA.put(`/api/v1/vehicles/${vanA.id}`).send({ ...edit, branch_id: B })).status).toBe(422);
    expect((await adminA.put(`/api/v1/vehicles/${vanA.id}`).send(edit)).body.data.branch).toMatchObject({ id: A });
    await viewerA.post("/api/v1/vehicle-bookings").send(trip({ vehicle_id: vanA.id }));
    expect((await adminA.post(`/api/v1/vehicles/${vanA.id}/transfer`).send({ branch_id: A })).status).toBe(422);
    expect((await adminA.post(`/api/v1/vehicles/${vanA.id}/transfer`).send({ branch_id: null })).status).toBe(422);
    expect((await adminB.post(`/api/v1/vehicles/${vanA.id}/transfer`).send({ branch_id: B })).status).toBe(404);
    const moved = await adminA.post(`/api/v1/vehicles/${vanA.id}/transfer`).send({ branch_id: B, note: "ย้ายไปประจำสาขา B" });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ branch: { id: B }, can_manage: false, upcoming_bookings: 1 });
    expect(ids(await viewerA.get("/api/v1/vehicles"))).toEqual([]);
    expect(ids(await viewerB.get("/api/v1/vehicles")).sort()).toEqual([vanA.id, vanB.id].sort());
    const history = await adminB.get(`/api/v1/vehicles/${vanA.id}/transfers`);
    expect(history.body.data).toEqual([expect.objectContaining({ from: { id: A, name: "สาขา A" }, to: { id: B, name: "สาขา B" }, note: "ย้ายไปประจำสาขา B", user_name: "Admin A" })]);
    expect((await select("SELECT 1 FROM audit_logs WHERE action = 'vehicle.transferred'")).length).toBe(1);
    // ไม่ได้ตั้งขอบเขต (กลุ่มอื่น) = เห็นทุกสาขาเหมือนเดิม
    expect((await root.get("/api/v1/vehicles")).body.data.length).toBe(2);
  });
});
