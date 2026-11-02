import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { kpiPendingCount } from "../src/services/kpi.js";
import { as, day, makeUser } from "./helpers.js";

/** จอง ZOOM: จอง → ฝ่าย IT รับงาน → ส่งลิงก์ (ใบงานปิดแล้วลง KPI ของผู้รับงาน) / แจ้งกลับว่ามีการใช้งานแล้ว */

const booking = (extra: Record<string, unknown> = {}) => ({
  title: "ประชุมลูกค้าออนไลน์",
  details: "ลูกค้าต่างประเทศ 5 คน",
  start_on: day(1),
  start_time: "09:00",
  end_on: day(1),
  end_time: "11:00",
  ...extra,
});
const notices = (userId: number, event: string) =>
  scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data LIKE '%\"kind\":\"zoom\"%' AND data LIKE ?", [userId, `%"event":"${event}"%`]);

describe("zoom bookings", () => {
  it("books, notifies IT, is accepted, gets a link (completed ticket → KPI row of the assignee) and the requester is notified", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(requester);
    const itApi = await as(it1);

    // บังคับหัวข้อ + วันเวลา (รายละเอียดไม่บังคับ)
    const bad = await api.post("/api/v1/zoom-bookings").send(booking({ title: " ", end_time: "08:00" }));
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors)).toContain("title");
    expect((await api.post("/api/v1/zoom-bookings").send(booking({ end_time: "08:00" }))).status).toBe(422);
    expect((await api.post("/api/v1/zoom-bookings").send(booking({ start_on: day(-2), end_on: day(-2) }))).status).toBe(422);

    const created = await api.post("/api/v1/zoom-bookings").send(booking({ details: null }));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ status: "pending", can_edit: true, can_cancel: true, can_accept: false });
    expect(Number(await notices(it1.id, "requested"))).toBe(1);
    expect((await itApi.get("/api/v1/menu-badges")).body.data["/zoom/manage"]).toBeGreaterThanOrEqual(1);

    // ปฏิทิน: ผู้ใช้ทั่วไปไม่เห็นคำขอที่ยังไม่ส่งลิงก์ (ฝ่าย IT เห็น)
    const outsider = await as(await makeUser());
    const calendar = async (a: typeof api) => ((await a.get(`/api/v1/zoom-bookings?from=${day(1)}&to=${day(1)}`)).body.data as { id: string }[]).map((x) => x.id);
    expect(await calendar(outsider)).not.toContain(id);
    expect(await calendar(api)).not.toContain(id);
    expect(await calendar(itApi)).toContain(id);
    expect((await outsider.get(`/api/v1/zoom-bookings/${id}`)).status).toBe(404);

    // ผู้ใช้ทั่วไปรับงาน / ส่งลิงก์ไม่ได้
    expect((await api.post(`/api/v1/zoom-bookings/${id}/accept`)).status).toBe(403);
    // ยังไม่รับงาน ส่งลิงก์ไม่ได้
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/1" })).status).toBe(422);

    const accepted = await itApi.post(`/api/v1/zoom-bookings/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: "accepted", assignee: { id: it1.id }, can_link: true });
    expect(Number(await notices(requester.id, "accepted"))).toBe(1);
    // รับงานแล้ว ผู้จองแก้ไม่ได้ (ยกเลิกได้)
    expect((await api.put(`/api/v1/zoom-bookings/${id}`).send(booking())).status).toBe(422);

    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "zoom.us/j/1" })).status).toBe(422);
    const kpiBefore = await kpiPendingCount(it1.id);
    // ฝ่าย IT นับรายการค้างบนแท็บได้
    expect((await itApi.get("/api/v1/zoom-bookings/manage?status=accepted")).body.meta.counts.accepted).toBeGreaterThanOrEqual(1);
    const linked = await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/123456", meeting_topic: "STEC,ประชุม", meeting_id: "916 7621 8538", passcode: "296181", link_note: "Join Zoom Meeting ..." });
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ status: "confirmed", meeting_link: "https://zoom.us/j/123456", meeting_topic: "STEC,ประชุม", meeting_id: "916 7621 8538", passcode: "296181" });
    expect(Number(await notices(requester.id, "confirmed"))).toBe(1);

    // ใบงานเรื่องอื่นๆ ปิดแล้ว ผู้รับงาน = ผู้ที่รับงาน → แถว KPI
    const ticket = await first<{ status: string; assignee_id: number; requester_id: number; type_other: string }>(
      "SELECT t.status, t.assignee_id, t.requester_id, t.type_other FROM zoom_bookings z JOIN it_tickets t ON t.id = z.ticket_id WHERE z.uuid = ?",
      [id],
    );
    expect(ticket).toMatchObject({ status: "completed", assignee_id: it1.id, requester_id: requester.id, type_other: "จองใช้งาน ZOOM" });
    expect(await kpiPendingCount(it1.id)).toBe(kpiBefore + 1);

    // แก้ลิงก์ = ไม่สร้างใบงานเพิ่ม + แจ้งผู้จอง
    const tickets = Number(await scalar("SELECT COUNT(*) FROM it_tickets WHERE requester_id = ?", [requester.id]));
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/999" })).body.data.meeting_link).toBe("https://zoom.us/j/999");
    expect(Number(await scalar("SELECT COUNT(*) FROM it_tickets WHERE requester_id = ?", [requester.id]))).toBe(tickets);
    expect(Number(await notices(requester.id, "link_updated"))).toBe(1);

    // ส่งลิงก์แล้ว = ขึ้นปฏิทินของทุกคน (ลิงก์เห็นเฉพาะผู้จอง + ฝ่าย IT)
    expect(await calendar(outsider)).toContain(id);
    const other = (await (await as(await makeUser())).get(`/api/v1/zoom-bookings/${id}`)).body.data;
    expect(other.meeting_link).toBeNull();
    expect(other.passcode).toBeNull();
    expect((await api.get(`/api/v1/zoom-bookings/${id}`)).body.data.meeting_link).toBe("https://zoom.us/j/999");
    const mine = (await api.get("/api/v1/zoom-bookings/mine")).body.data as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(id);
  });

  it("IT replies that the slot is taken (rejected + reason) and the requester is notified; the requester can edit before acceptance and cancel", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(requester);
    const itApi = await as(it1);

    const a = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    const edited = await api.put(`/api/v1/zoom-bookings/${a}`).send(booking({ title: "ประชุมแก้ไข", end_time: "12:00" }));
    expect(edited.body.data).toMatchObject({ title: "ประชุมแก้ไข", end_time: "12:00" });
    // คนอื่นไม่เห็นคำขอที่ยังไม่ส่งลิงก์ = 404
    expect((await (await as(await makeUser())).put(`/api/v1/zoom-bookings/${a}`).send(booking())).status).toBe(404);

    const busy = await itApi.post(`/api/v1/zoom-bookings/${a}/busy`).send({});
    expect(busy.status).toBe(200);
    expect(busy.body.data.status).toBe("rejected");
    expect(busy.body.data.reject_reason).toContain("ZOOM");
    expect(Number(await notices(requester.id, "rejected"))).toBe(1);
    expect(((await api.get("/api/v1/zoom-bookings/mine?status=cancelled")).body.data as { id: string }[]).map((x) => x.id)).toContain(a);
    // ปฏิเสธแล้วไม่ขึ้นปฏิทิน
    expect(((await api.get(`/api/v1/zoom-bookings?from=${day(1)}&to=${day(1)}`)).body.data as { id: string }[]).map((x) => x.id)).not.toContain(a);

    // ยกเลิกหลัง IT รับงาน → แจ้งผู้รับงาน
    const b = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${b}/accept`);
    expect((await api.post(`/api/v1/zoom-bookings/${b}/cancel`)).body.data.status).toBe("cancelled");
    expect(Number(await notices(it1.id, "cancelled"))).toBe(1);
    expect((await itApi.post(`/api/v1/zoom-bookings/${b}/busy`).send({ reason: "x" })).status).toBe(422);
  });
});
