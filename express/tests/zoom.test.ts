import { describe, expect, it } from "vitest";
import { exec, first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { expireZoomBookings } from "../src/routes/zoom.js";
import { kpiPendingCount } from "../src/services/kpi.js";
import { as, day, makeUser, realImage } from "./helpers.js";

/**
 * จอง ZOOM: จอง = เปิดใบแจ้งงาน → ฝ่าย IT รับงาน → ส่งลิงก์ → ผู้จัดการ IT อนุมัติ (ประทับชื่อ + ลายเซ็น → KPI) → ผู้จองกดรับ
 * แจ้งกลับว่าไม่ว่าง = ผู้จองแก้วันเวลาแล้วส่งกลับใบเดิม / ยกเลิก = ใบงานยกเลิก ไม่นับ KPI
 */

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
const ticketOf = (id: string) =>
  first<{ id: number; uuid: string; status: string; source: string; assignee_id: number | null; requester_id: number; type_other: string; it_head_id: number | null; it_head_signature: string | null; details: string; result: string | null }>(
    "SELECT t.* FROM zoom_bookings z JOIN it_tickets t ON t.id = z.ticket_id WHERE z.uuid = ?",
    [id],
  );
const signature = async (api: Awaited<ReturnType<typeof as>>) => {
  const res = await api.post("/api/v1/auth/me/signature").field("source", "DRAW").attach("signature", await realImage(800, 300, "png", { w: 500, h: 100 }), "sig.png");
  expect(res.status).toBe(200);
};
const LINK = { zoom_account: "bkk", meeting_link: "https://zoom.us/j/123456", meeting_topic: "STEC,ประชุม", meeting_id: "916 7621 8538", passcode: "296181", link_note: "Join Zoom Meeting ..." };
/** ผู้จอง / เจ้าหน้าที่ IT / ผู้จัดการ IT */
async function people() {
  const seeded = nowDb();
  for (const name of ["bkk", "Zoom01"]) await insert("dropdown_options", { list: "zoom_account", name, is_active: true, sort_order: 0, created_at: seeded, updated_at: seeded });
  const requester = await makeUser();
  const it1 = await makeUser({ role: "admin", is_it_staff: true });
  const head = await makeUser({ role: "super_admin", is_it_head: true });
  return { requester, it1, head, api: await as(requester), itApi: await as(it1), headApi: await as(head) };
}

describe("zoom bookings", () => {
  it("full flow: booking opens a ticket, IT accepts and sends the link, the IT manager stamps name + signature (KPI), the booker acknowledges", async () => {
    const { requester, it1, head, api, itApi, headApi } = await people();

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

    // จอง = มีใบงานทันที เดินสถานะจากหน้า ZOOM (ไม่ขึ้นคิวงาน IT / ตัวเลขใบงาน)
    expect(await ticketOf(id)).toMatchObject({ status: "approved", source: "zoom", requester_id: requester.id, type_other: "จองใช้งาน ZOOM" });
    const ticket = (await ticketOf(id))!;
    const queue = (await itApi.get("/api/v1/tickets?scope=it")).body.data as { id: string }[];
    expect(queue.map((x) => x.id)).not.toContain(ticket.uuid);
    expect(((await itApi.get("/api/v1/tickets?scope=all")).body.data as { id: string }[]).map((x) => x.id)).toContain(ticket.uuid);
    const detail = (await itApi.get(`/api/v1/tickets/${ticket.uuid}`)).body.data;
    expect(detail.zoom_booking_id).toBe(id);
    expect(detail.actions).toEqual([]);
    // ปุ่มในหน้าใบงานใช้ไม่ได้
    expect((await itApi.post(`/api/v1/tickets/${ticket.uuid}/accept`).send({})).status).toBe(403);

    // ปฏิทิน: ผู้ใช้ทั่วไปไม่เห็นคำขอที่ยังไม่ส่งลิงก์ (ฝ่าย IT เห็น)
    const outsider = await as(await makeUser());
    const calendar = async (a: typeof api) => ((await a.get(`/api/v1/zoom-bookings?from=${day(1)}&to=${day(1)}`)).body.data as { id: string }[]).map((x) => x.id);
    expect(await calendar(outsider)).not.toContain(id);
    expect(await calendar(api)).not.toContain(id);
    expect(await calendar(itApi)).toContain(id);
    expect((await outsider.get(`/api/v1/zoom-bookings/${id}`)).status).toBe(404);

    // ผู้ใช้ทั่วไปรับงาน / ส่งลิงก์ไม่ได้ · ยังไม่รับงาน ส่งลิงก์ไม่ได้
    expect((await api.post(`/api/v1/zoom-bookings/${id}/accept`)).status).toBe(403);
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/1" })).status).toBe(422);

    const accepted = await itApi.post(`/api/v1/zoom-bookings/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: "accepted", assignee: { id: it1.id }, can_link: true });
    expect(await ticketOf(id)).toMatchObject({ status: "in_progress", assignee_id: it1.id });
    expect(Number(await notices(requester.id, "accepted"))).toBe(1);
    // รับงานแล้ว ผู้จองแก้ไม่ได้ (ยกเลิกได้)
    expect((await api.put(`/api/v1/zoom-bookings/${id}`).send(booking())).status).toBe(422);

    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "zoom.us/j/1" })).status).toBe(422);
    expect((await itApi.get("/api/v1/zoom-bookings/manage?status=accepted")).body.meta.counts.accepted).toBeGreaterThanOrEqual(1);

    // ส่งลิงก์ = ผู้จองเห็นทันที ใบงานรออนุมัติผล ยังไม่ขึ้น KPI + แจ้งผู้จัดการ IT
    const kpiBefore = await kpiPendingCount(it1.id);
    const linked = await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send(LINK);
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ status: "confirmed", meeting_link: LINK.meeting_link, meeting_topic: "STEC,ประชุม", meeting_id: "916 7621 8538", passcode: "296181" });
    expect((await api.get(`/api/v1/zoom-bookings/${id}`)).body.data).toMatchObject({ meeting_link: LINK.meeting_link, can_acknowledge: false });
    expect(Number(await notices(requester.id, "confirmed"))).toBe(1);
    expect(Number(await notices(head.id, "head_requested"))).toBe(1);
    expect(await ticketOf(id)).toMatchObject({ status: "pending_it_head", result: "completed" });
    expect(await kpiPendingCount(it1.id)).toBe(kpiBefore);
    // ผู้จัดการ IT เห็นที่คิวงาน IT + ตัวเลขเมนู และกดอนุมัติที่หน้าใบแจ้งงาน (ปุ่มอื่นในใบยังปิด)
    expect((await headApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(1);
    expect(((await headApi.get("/api/v1/tickets?scope=it")).body.data as { id: string }[]).map((x) => x.id)).toContain(ticket.uuid);
    expect(((await itApi.get("/api/v1/tickets?scope=it_mine")).body.data as { id: string }[]).map((x) => x.id)).not.toContain(ticket.uuid);
    const review = (await headApi.get(`/api/v1/tickets/${ticket.uuid}`)).body.data;
    expect(review.actions).toEqual([]);
    expect(review.can_zoom_approve).toBe(true);
    expect(review.zoom_booking_id).toBe(id);
    expect((await itApi.get(`/api/v1/tickets/${ticket.uuid}`)).body.data.can_zoom_approve).toBe(false);
    expect((await headApi.post(`/api/v1/tickets/${ticket.uuid}/close`).send({ signature: "x" })).status).toBe(403);
    expect((await headApi.post(`/api/v1/tickets/${ticket.uuid}/return`).send({ comment: "x" })).status).toBe(403);
    const notice = await first<{ data: string }>("SELECT data FROM notifications WHERE notifiable_id = ? AND data LIKE '%\"event\":\"head_requested\"%'", [head.id]);
    expect(JSON.parse(notice!.data).open_ticket).toBe(ticket.uuid);

    // ผู้รับงานอนุมัติงานตัวเองไม่ได้ (มีผู้จัดการคนอื่น) · ผู้ไม่มีสิทธิ์ไม่ได้ · ไม่มีลายเซ็นในโปรไฟล์ = 422
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/approve`)).status).toBe(403);
    expect((await api.post(`/api/v1/zoom-bookings/${id}/approve`)).status).toBe(403);
    const noSignature = await headApi.post(`/api/v1/zoom-bookings/${id}/approve`);
    expect(noSignature.status).toBe(422);
    expect(Object.keys(noSignature.body.errors)).toContain("signature");

    await signature(headApi);
    const approved = await headApi.post(`/api/v1/zoom-bookings/${id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.head_approval.name).toBe(head.name);
    const stamped = (await ticketOf(id))!;
    expect(stamped).toMatchObject({ status: "pending_requester", it_head_id: head.id });
    expect(stamped.it_head_signature).toBeTruthy();
    expect(await kpiPendingCount(it1.id)).toBe(kpiBefore + 1);
    expect(Number(await notices(requester.id, "head_approved"))).toBe(1);
    expect((await headApi.get("/api/v1/menu-badges")).body.data["/it/queue"]).toBe(0);
    // ซ้ำไม่ได้
    expect((await headApi.post(`/api/v1/zoom-bookings/${id}/approve`)).status).toBe(422);

    // ผู้จองกดรับ = ปิดงาน (ตัวเลขเมนู + แท็บ หาย) — ไม่นับที่เมนูใบแจ้งงาน
    const badges = (await api.get("/api/v1/menu-badges")).body.data;
    expect(badges["/zoom/mine"]).toBe(1);
    expect(badges["/tickets"]).toBe(0);
    const mineTodo = await api.get("/api/v1/zoom-bookings/mine?status=todo");
    expect(mineTodo.body.meta.counts.todo).toBe(1);
    expect((mineTodo.body.data as { id: string; can_acknowledge: boolean }[])[0]).toMatchObject({ id, can_acknowledge: true });
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/acknowledge`)).status).toBe(403);
    expect((await api.post(`/api/v1/zoom-bookings/${id}/acknowledge`)).status).toBe(200);
    expect(await ticketOf(id)).toMatchObject({ status: "completed" });
    expect((await api.get("/api/v1/menu-badges")).body.data["/zoom/mine"]).toBe(0);
    expect((await api.post(`/api/v1/zoom-bookings/${id}/acknowledge`)).status).toBe(422);
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
    expect(other.head_approval).toBeNull();
    expect((await api.get(`/api/v1/zoom-bookings/${id}`)).body.data.meeting_link).toBe("https://zoom.us/j/999");
  });

  it("IT says the time is taken: the booker changes it and it returns to the same ticket and the same IT staff", async () => {
    const { requester, it1, api, itApi } = await people();

    const a = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    const edited = await api.put(`/api/v1/zoom-bookings/${a}`).send(booking({ title: "ประชุมแก้ไข", end_time: "12:00" }));
    expect(edited.body.data).toMatchObject({ title: "ประชุมแก้ไข", end_time: "12:00" });
    expect((await ticketOf(a))!.details).toContain("ประชุมแก้ไข");
    // คนอื่นไม่เห็นคำขอที่ยังไม่ส่งลิงก์ = 404
    expect((await (await as(await makeUser())).put(`/api/v1/zoom-bookings/${a}`).send(booking())).status).toBe(404);

    // ยังไม่มีผู้รับงาน → แจ้งกลับ → แก้แล้วกลับไปรอรับงาน แจ้ง IT ใหม่
    const ticketId = (await ticketOf(a))!.id;
    const busy = await itApi.post(`/api/v1/zoom-bookings/${a}/busy`).send({});
    expect(busy.status).toBe(200);
    expect(busy.body.data).toMatchObject({ status: "needs_change", can_accept: false, can_busy: false });
    expect(busy.body.data.reject_reason).toContain("ZOOM");
    expect(Number(await notices(requester.id, "needs_change"))).toBe(1);
    expect((await ticketOf(a))!.status).toBe("approved");
    // ไม่ขึ้นปฏิทิน + ตัวเลขเมนู/แท็บของผู้จอง + ยังยกเลิกได้
    expect(((await itApi.get(`/api/v1/zoom-bookings?from=${day(1)}&to=${day(1)}`)).body.data as { id: string }[]).map((x) => x.id)).not.toContain(a);
    expect((await api.get("/api/v1/menu-badges")).body.data["/zoom/mine"]).toBe(1);
    const todo = (await api.get("/api/v1/zoom-bookings/mine?status=todo")).body.data[0];
    expect(todo).toMatchObject({ id: a, can_edit: true, can_cancel: true });
    expect((await itApi.get("/api/v1/zoom-bookings/manage?status=needs_change")).body.meta.counts.needs_change).toBe(1);
    // ต้องเปลี่ยนวันหรือเวลา
    const same = await api.put(`/api/v1/zoom-bookings/${a}`).send(booking({ title: "ประชุมแก้ไข", end_time: "12:00" }));
    expect(same.status).toBe(422);
    expect(Object.keys(same.body.errors)).toContain("start_on");

    const requested = Number(await notices(it1.id, "requested"));
    const back = await api.put(`/api/v1/zoom-bookings/${a}`).send(booking({ start_time: "13:00", end_time: "15:00" }));
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: "pending", start_time: "13:00", reject_reason: null, can_accept: false });
    expect(Number(await notices(it1.id, "requested"))).toBe(requested + 1);
    expect((await ticketOf(a))!.id).toBe(ticketId);
    expect((await ticketOf(a))!.details).toContain("13:00");
    expect((await api.get("/api/v1/menu-badges")).body.data["/zoom/mine"]).toBe(0);

    // รับงานแล้วแจ้งกลับ → แก้แล้วกลับไปหาผู้รับงานเดิม ส่งลิงก์ได้เลย
    expect((await itApi.post(`/api/v1/zoom-bookings/${a}/accept`)).status).toBe(200);
    expect((await itApi.post(`/api/v1/zoom-bookings/${a}/busy`).send({ reason: "ติดอบรม" })).body.data.reject_reason).toBe("ติดอบรม");
    expect((await itApi.post(`/api/v1/zoom-bookings/${a}/link`).send(LINK)).status).toBe(422);
    const backToIt = await api.put(`/api/v1/zoom-bookings/${a}`).send(booking({ start_on: day(2), end_on: day(2) }));
    expect(backToIt.body.data).toMatchObject({ status: "accepted", assignee: { id: it1.id } });
    expect(Number(await notices(it1.id, "resubmitted"))).toBe(1);
    expect((await ticketOf(a))!.status).toBe("in_progress");
    expect((await itApi.post(`/api/v1/zoom-bookings/${a}/link`).send(LINK)).body.data.status).toBe("confirmed");
  });

  it("cancelling closes the ticket without KPI at every stage; an unanswered booking expires", async () => {
    const { requester, it1, api, itApi, headApi } = await people();
    await signature(headApi);

    // รับงานแล้ว → แจ้งผู้รับงาน
    const b = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${b}/accept`);
    expect((await api.post(`/api/v1/zoom-bookings/${b}/cancel`)).body.data.status).toBe("cancelled");
    expect(Number(await notices(it1.id, "cancelled"))).toBe(1);
    expect((await ticketOf(b))!.status).toBe("cancelled");
    expect((await itApi.post(`/api/v1/zoom-bookings/${b}/busy`).send({ reason: "x" })).status).toBe(422);

    // หลังอนุมัติแล้ว (ขึ้น KPI แล้ว) ยกเลิก = ออกจาก KPI
    const kpiBefore = await kpiPendingCount(it1.id);
    const c = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${c}/accept`);
    await itApi.post(`/api/v1/zoom-bookings/${c}/link`).send(LINK);
    expect((await headApi.post(`/api/v1/zoom-bookings/${c}/approve`)).status).toBe(200);
    expect(await kpiPendingCount(it1.id)).toBe(kpiBefore + 1);
    expect((await api.post(`/api/v1/zoom-bookings/${c}/cancel`)).status).toBe(200);
    expect((await ticketOf(c))!.status).toBe("cancelled");
    expect(await kpiPendingCount(it1.id)).toBe(kpiBefore);
    expect((await api.get("/api/v1/menu-badges")).body.data["/zoom/mine"]).toBe(0);

    // รอแก้วันเวลา แล้วยกเลิกได้
    const d = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${d}/busy`).send({});
    expect((await api.post(`/api/v1/zoom-bookings/${d}/cancel`)).status).toBe(200);
    expect((await ticketOf(d))!.status).toBe("cancelled");

    // ไม่แก้จนเลยเวลา → scheduler ยกเลิก + แจ้งผู้จอง / ส่งลิงก์แล้วไม่ยุ่ง
    const e = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${e}/busy`).send({});
    const f = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${f}/accept`);
    await itApi.post(`/api/v1/zoom-bookings/${f}/link`).send(LINK);
    await exec("UPDATE zoom_bookings SET start_on = ?, end_on = ? WHERE uuid IN (?)", [day(-2), day(-2), [e, f]]);
    expect(await expireZoomBookings()).toBe(1);
    expect((await api.get(`/api/v1/zoom-bookings/${e}`)).body.data.status).toBe("cancelled");
    expect((await ticketOf(e))!.status).toBe("cancelled");
    expect(Number(await notices(requester.id, "expired"))).toBe(1);
    // ประชุมจบแล้วผู้จัดการยังอนุมัติผล และผู้จองกดรับได้
    expect((await api.get(`/api/v1/zoom-bookings/${f}`)).body.data.status).toBe("confirmed");
    expect((await headApi.post(`/api/v1/zoom-bookings/${f}/approve`)).status).toBe(200);
    expect((await api.post(`/api/v1/zoom-bookings/${f}/acknowledge`)).status).toBe(200);
  });

  it("IT chooses the ZOOM account from the dropdown list; IT can rename, add and remove accounts", async () => {
    const { api, itApi, it1 } = await people();
    const id = (await api.post("/api/v1/zoom-bookings").send(booking())).body.data.id as string;
    await itApi.post(`/api/v1/zoom-bookings/${id}/accept`);

    // บังคับเลือก + ต้องอยู่ในรายการ
    const none = await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/1" });
    expect(none.status).toBe(422);
    expect(Object.keys(none.body.errors)).toContain("zoom_account");
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/1", zoom_account: "ไม่มีบัญชีนี้" })).status).toBe(422);
    const linked = await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/1", zoom_account: "ZOOM01" });
    expect(linked.body.data.zoom_account).toBe("Zoom01");
    // ปฏิทินของทุกคนได้ชื่อบัญชี (สีตามบัญชี) แต่ไม่ได้ลิงก์ · แก้ลิงก์ไม่ส่ง = คงเดิม
    const calendarRow = ((await (await as(await makeUser())).get(`/api/v1/zoom-bookings?from=${day(1)}&to=${day(1)}`)).body.data as { id: string; zoom_account: string; meeting_link: string | null }[]).find((x) => x.id === id);
    expect(calendarRow).toMatchObject({ zoom_account: "Zoom01", meeting_link: null });
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send({ meeting_link: "https://zoom.us/j/2" })).body.data.zoom_account).toBe("Zoom01");

    // จัดการรายการ: ผู้ใช้ทั่วไปไม่ได้ / IT เพิ่ม-เปลี่ยนชื่อ (ข้อมูลเดิมตาม)-ลบได้ (ลบไม่ได้เมื่อมีข้อมูลใช้อยู่)
    expect((await api.post("/api/v1/dropdown-options/zoom_account").send({ name: "x" })).status).toBe(403);
    const added = await itApi.post("/api/v1/dropdown-options/zoom_account").send({ name: "Zoom02" });
    expect(added.status).toBe(201);
    expect((await itApi.delete(`/api/v1/dropdown-options/zoom_account/${added.body.data.id}`)).status).toBeLessThan(300);
    const list = (await itApi.get("/api/v1/dropdown-options/zoom_account?include_inactive=1")).body.data as { id: number; name: string; usage_count: number }[];
    const used = list.find((o) => o.name === "Zoom01")!;
    expect(used.usage_count).toBe(1);
    expect((await itApi.delete(`/api/v1/dropdown-options/zoom_account/${used.id}`)).status).toBe(422);
    expect((await itApi.put(`/api/v1/dropdown-options/zoom_account/${used.id}`).send({ name: "Zoom-Main" })).status).toBe(200);
    expect((await itApi.get(`/api/v1/zoom-bookings/${id}`)).body.data.zoom_account).toBe("Zoom-Main");
    expect(it1.id).toBeGreaterThan(0);
  });

  it("a booking made before this flow (no ticket yet) gets its ticket when the link is sent", async () => {
    const { requester, it1, itApi } = await people();
    const now = nowDb();
    const id = "11111111-2222-4333-8444-555555555555";
    await insert("zoom_bookings", { uuid: id, user_id: requester.id, title: "เดิม", start_on: day(1), start_time: "09:00", end_on: day(1), end_time: "10:00", status: "accepted", assignee_id: it1.id, accepted_at: now, created_at: now, updated_at: now });
    expect(await ticketOf(id)).toBeNull();
    expect((await itApi.post(`/api/v1/zoom-bookings/${id}/link`).send(LINK)).body.data.status).toBe("confirmed");
    expect(await ticketOf(id)).toMatchObject({ status: "pending_it_head", source: "zoom", assignee_id: it1.id });
  });

  it("booking a meeting room with ZOOM: same time, cancel follows the room, time changes follow the room, busy keeps the room", async () => {
    const { requester, it1, api, itApi } = await people();
    const now = nowDb();
    await insert("dropdown_options", { list: "meeting_purpose", name: "ประชุม", is_active: true, sort_order: 0, created_at: now, updated_at: now });
    const root = await as(await makeUser({ role: "super_admin" }));
    const room = (await root.post("/api/v1/meeting-rooms").send({ name: "ห้อง Z", branch_id: null, seats: [{ label: "ที่นั่งหลัก", count: 10 }] })).body.data;
    const meeting = (extra: Record<string, unknown> = {}) => ({ room_id: room.id, title: "ประชุมทีม", attendees: 5, purpose: "ประชุม", date: day(1), start_time: "09:00", end_time: "10:00", ...extra });

    // ไม่ติ๊ก = ไม่จอง ZOOM
    const plain = await api.post("/api/v1/meeting-bookings").send(meeting({ start_time: "15:00", end_time: "16:00" }));
    expect(plain.body.data.zoom).toBeNull();

    const created = await api.post("/api/v1/meeting-bookings").send(meeting({ zoom: { details: "ลูกค้าเข้าร่วม 3 คน" } }));
    expect(created.status).toBe(201);
    const zid = created.body.data.zoom.id as string;
    const z = (await api.get(`/api/v1/zoom-bookings/${zid}`)).body.data;
    // ไม่กรอกหัวข้อ = หัวข้อประชุม
    expect(z).toMatchObject({ title: "ประชุมทีม", details: "ลูกค้าเข้าร่วม 3 คน", start_on: day(1), start_time: "09:00", end_time: "10:00", status: "pending", from_meeting: true });
    expect(Number(await notices(it1.id, "requested"))).toBe(1);

    // IT แจ้งไม่ว่าง → ห้องยังอยู่ · แก้เวลาห้อง = ส่งกลับ IT พร้อมเวลาใหม่
    await itApi.post(`/api/v1/zoom-bookings/${zid}/busy`).send({});
    expect((await api.get(`/api/v1/meeting-bookings/${created.body.data.id}`)).body.data.status).toBe("confirmed");
    const moved = await api.put(`/api/v1/meeting-bookings/${created.body.data.id}`).send(meeting({ start_time: "11:00", end_time: "12:00" }));
    expect(moved.status).toBe(200);
    expect((await api.get(`/api/v1/zoom-bookings/${zid}`)).body.data).toMatchObject({ status: "pending", start_time: "11:00", end_time: "12:00" });

    // ส่งลิงก์แล้วย้ายเวลา = เวลาตาม + แจ้งผู้รับงาน
    await itApi.post(`/api/v1/zoom-bookings/${zid}/accept`);
    await itApi.post(`/api/v1/zoom-bookings/${zid}/link`).send(LINK);
    await api.put(`/api/v1/meeting-bookings/${created.body.data.id}`).send(meeting({ start_time: "13:00", end_time: "14:00" }));
    expect((await api.get(`/api/v1/zoom-bookings/${zid}`)).body.data).toMatchObject({ status: "confirmed", start_time: "13:00" });
    expect(Number(await notices(it1.id, "time_changed"))).toBe(1);
    // ส่ง zoom ซ้ำตอนแก้ไข = ไม่จองซ้ำ
    await api.put(`/api/v1/meeting-bookings/${created.body.data.id}`).send(meeting({ start_time: "13:00", end_time: "14:00", zoom: {} }));
    expect(Number(await scalar("SELECT COUNT(*) FROM zoom_bookings WHERE user_id = ? AND meeting_booking_id IS NOT NULL", [requester.id]))).toBe(1);

    // ยกเลิกห้อง = ZOOM + ใบงาน ยกเลิกตาม
    expect((await api.post(`/api/v1/meeting-bookings/${created.body.data.id}/cancel`)).status).toBe(200);
    expect((await api.get(`/api/v1/zoom-bookings/${zid}`)).body.data.status).toBe("cancelled");
    expect((await ticketOf(zid))!.status).toBe("cancelled");

    // ตั้งเวลา ZOOM ต่างจากห้องได้ — เปลี่ยนเวลาห้องแล้วไม่ทับ, เวลาผิดลำดับ = 422 และไม่บันทึกห้อง
    expect((await api.post("/api/v1/meeting-bookings").send(meeting({ date: day(3), zoom: { start_on: day(3), start_time: "10:00", end_on: day(3), end_time: "09:00" } }))).status).toBe(422);
    expect(Number(await scalar("SELECT COUNT(*) FROM meeting_bookings WHERE booking_date = ?", [day(3)]))).toBe(0);
    const custom = await api.post("/api/v1/meeting-bookings").send(meeting({ date: day(3), zoom: { title: "แยกเวลา", start_on: day(4), start_time: "08:00", end_on: day(4), end_time: "08:30" } }));
    expect(custom.status).toBe(201);
    const customZoom = custom.body.data.zoom.id as string;
    expect((await api.get(`/api/v1/zoom-bookings/${customZoom}`)).body.data).toMatchObject({ start_on: day(4), start_time: "08:00", end_time: "08:30" });
    await api.put(`/api/v1/meeting-bookings/${custom.body.data.id}`).send(meeting({ date: day(3), start_time: "11:00", end_time: "12:00" }));
    expect((await api.get(`/api/v1/zoom-bookings/${customZoom}`)).body.data).toMatchObject({ start_on: day(4), start_time: "08:00" });

    // เอา ZOOM ออกตอนแก้ไข = ยกเลิก ZOOM + ใบงาน แต่ห้องคงเดิม
    const kept = await api.post("/api/v1/meeting-bookings").send(meeting({ date: day(2), zoom: { title: "ออกทีหลัง" } }));
    const keptZoom = kept.body.data.zoom.id as string;
    const dropped = await api.put(`/api/v1/meeting-bookings/${kept.body.data.id}`).send(meeting({ date: day(2), zoom_cancel: true }));
    expect(dropped.body.data).toMatchObject({ status: "confirmed", zoom: null });
    expect((await ticketOf(keptZoom))!.status).toBe("cancelled");

    // ติ๊กเพิ่ม ZOOM ตอนแก้ไข · ลบการจองห้อง = ยกเลิกตาม
    const added = await api.put(`/api/v1/meeting-bookings/${plain.body.data.id}`).send(meeting({ start_time: "15:00", end_time: "16:00", zoom: { title: "หัวข้อ ZOOM" } }));
    expect(added.body.data.zoom.status).toBe("pending");
    const addedId = added.body.data.zoom.id as string;
    expect((await api.get(`/api/v1/zoom-bookings/${addedId}`)).body.data.title).toBe("หัวข้อ ZOOM");
    expect((await api.delete(`/api/v1/meeting-bookings/${plain.body.data.id}`)).status).toBe(204);
    expect((await api.get(`/api/v1/zoom-bookings/${addedId}`)).body.data.status).toBe("cancelled");
  });
});
