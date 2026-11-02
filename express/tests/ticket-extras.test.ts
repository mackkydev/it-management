import { describe, expect, it } from "vitest";
import { first, insert, scalar } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { autoCloseTickets } from "../src/routes/tickets.js";
import { as, fakeImage, fakePdf, makeUser, realImage, SIG } from "./helpers.js";

/** ผู้ร่วมดำเนินการในคิวงาน/แจ้งเตือน, เก็บลายเซ็นที่วาดในเอกสาร, ปิดงานอัตโนมัติ */

let seq = 0;
async function ticket(attrs: Record<string, unknown>): Promise<{ id: number; uuid: string }> {
  const uuid = crypto.randomUUID();
  const id = await insert("it_tickets", {
    uuid, ticket_no: `FM-ITR-01-2026-9${String(++seq).padStart(4, "0")}`, type: "other", type_other: "งานทดสอบ", status: "in_progress", details: "ทดสอบ",
    requested_at: nowDb(), created_at: nowDb(), updated_at: nowDb(), ...attrs,
  });
  return { id, uuid };
}
const events = (userId: number) => scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data LIKE '%returned%'", [userId]);

describe("ticket co-workers, drawn signatures and auto-close", () => {
  it("co-workers see the ticket in 'my queue', count it on the menu badge and get notified when the work is returned", async () => {
    const requester = await makeUser();
    const owner = await makeUser({ is_it_staff: true });
    const helper = await makeUser({ is_it_staff: true });
    const head = await makeUser({ is_it_head: true, is_it_staff: true });
    const t = await ticket({ requester_id: requester.id, assignee_id: owner.id, accepted_at: nowDb() });
    await insert("it_ticket_helpers", { it_ticket_id: t.id, user_id: helper.id, added_by: owner.id, created_at: nowDb(), updated_at: nowDb() });

    const api = await as(helper);
    expect((await api.get("/api/v1/menu-badges")).body.data["/it/tickets"]).toBe(1);
    const mine = (await api.get("/api/v1/tickets?scope=it_mine")).body.data as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(t.uuid);

    // หัวหน้า IT ส่งกลับแก้ไข → ผู้รับงาน + ผู้ร่วมดำเนินการได้แจ้งเตือน
    await (await as(owner)).post(`/api/v1/tickets/${t.uuid}/result`).send({ result: "completed", completed_on: nowDb().slice(0, 10), signature: SIG });
    expect((await (await as(head)).post(`/api/v1/tickets/${t.uuid}/return`).send({ comment: "แก้ไข" })).status).toBe(200);
    expect(Number(await events(owner.id))).toBe(1);
    expect(Number(await events(helper.id))).toBe(1);
  });

  it("with signatures required, a signature drawn on a document is kept as the profile signature of someone who has none", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await makeUser({ is_it_staff: true });
    const t = await ticket({ requester_id: (await makeUser()).id, assignee_id: staff.id, accepted_at: nowDb() });
    const t2 = await ticket({ requester_id: (await makeUser()).id, assignee_id: staff.id, accepted_at: nowDb() });

    // ปิดบังคับ = ไม่เก็บ
    await (await as(staff)).post(`/api/v1/tickets/${t.uuid}/result`).send({ result: "completed", completed_on: nowDb().slice(0, 10), signature: SIG });
    expect(await first("SELECT 1 AS x FROM user_signatures WHERE user_id = ?", [staff.id])).toBeNull();

    await root.put("/api/v1/settings").send({ require_signature: true });
    const drawn = `data:image/png;base64,${(await realImage(600, 200, "png")).toString("base64")}`;
    const res = await (await as(staff)).post(`/api/v1/tickets/${t2.uuid}/result`).send({ result: "completed", completed_on: nowDb().slice(0, 10), signature: drawn });
    expect(res.status).toBe(200);
    expect(await first("SELECT source FROM user_signatures WHERE user_id = ? AND is_active = true", [staff.id])).toMatchObject({ source: "DRAW" });
    expect((await (await as(staff)).get("/api/v1/auth/me")).body.data.has_signature).toBe(true);
    await root.put("/api/v1/settings").send({ require_signature: false });
  });

  it("closes tickets the requester has not accepted within the configured days, and shows the deadline on the ticket", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const requester = await makeUser();
    const staff = await makeUser({ is_it_staff: true });
    const helper = await makeUser({ is_it_staff: true });
    const old = await ticket({ status: "pending_requester", requester_id: requester.id, assignee_id: staff.id });
    await insert("it_ticket_helpers", { it_ticket_id: old.id, user_id: helper.id, added_by: staff.id, created_at: nowDb(), updated_at: nowDb() });
    await insert("it_ticket_events", { it_ticket_id: old.id, user_id: staff.id, action: "head_approved", created_at: "2026-01-01 00:00:00" });
    const fresh = await ticket({ status: "pending_requester", requester_id: requester.id, assignee_id: staff.id });
    await insert("it_ticket_events", { it_ticket_id: fresh.id, user_id: staff.id, action: "head_approved", created_at: nowDb() });

    // ค่าตั้งต้น 7 วัน — หน้าใบงานบอกกำหนดปิด
    const detail = (await (await as(requester)).get(`/api/v1/tickets/${fresh.uuid}`)).body.data;
    expect(detail.auto_close.days).toBe(7);
    expect(detail.auto_close.at).toBeTruthy();

    // 0 = ปิดความสามารถนี้
    await root.put("/api/v1/settings").send({ ticket_auto_close_days: 0 });
    expect(await autoCloseTickets()).toBe(0);
    await root.put("/api/v1/settings").send({ ticket_auto_close_days: 7 });
    expect(await autoCloseTickets()).toBe(1);

    expect(await scalar("SELECT status FROM it_tickets WHERE id = ?", [old.id])).toBe("completed");
    expect(await scalar("SELECT status FROM it_tickets WHERE id = ?", [fresh.id])).toBe("pending_requester");
    expect(await first("SELECT 1 AS x FROM it_ticket_events WHERE it_ticket_id = ? AND action = 'auto_closed'", [old.id])).toBeTruthy();
    for (const u of [requester, staff, helper]) {
      expect(await first("SELECT 1 AS x FROM notifications WHERE notifiable_id = ? AND data LIKE '%\"event\":\"closed\"%'", [u.id])).toBeTruthy();
    }
    expect((await (await as(requester)).get(`/api/v1/tickets/${old.uuid}`)).body.data.auto_close.at).toBeNull();
  });

  it("the all-requests list filters by IT staff (assignee or co-worker) and request date in local time", async () => {
    const requester = await makeUser();
    const staff = await makeUser({ is_it_staff: true });
    const other = await makeUser({ is_it_staff: true });
    const mine = await ticket({ requester_id: requester.id, assignee_id: staff.id, requested_at: "2026-03-10 03:00:00" });
    const helped = await ticket({ requester_id: requester.id, assignee_id: other.id, requested_at: "2026-03-20 03:00:00" });
    await insert("it_ticket_helpers", { it_ticket_id: helped.id, user_id: staff.id, added_by: other.id, created_at: nowDb(), updated_at: nowDb() });
    // 31 มี.ค. 18:00 UTC = 1 เม.ย. เวลาไทย
    const late = await ticket({ requester_id: requester.id, assignee_id: staff.id, requested_at: "2026-03-31 18:00:00" });
    await ticket({ requester_id: requester.id, assignee_id: other.id, requested_at: "2026-03-15 03:00:00" });

    const api = await as(staff);
    const ids = async (q: string) => ((await api.get(`/api/v1/tickets?scope=all&per_page=100&${q}`)).body.data as { id: string }[]).map((x) => x.id).sort();
    expect(await ids(`staff_id=${staff.id}&from=2026-03-01&to=2026-03-31`)).toEqual([mine.uuid, helped.uuid].sort());
    expect(await ids(`staff_id=${staff.id}&from=2026-04-01&to=2026-04-01`)).toEqual([late.uuid]);
    expect((await (await as(requester)).get("/api/v1/tickets?scope=all")).status).toBe(403);
  });

  it("the dashboard summarises my own requests, IT work and bookings", async () => {
    const requester = await makeUser();
    const staff = await makeUser({ is_it_staff: true });
    await ticket({ requester_id: requester.id, assignee_id: staff.id, status: "pending_requester", completed_on: nowDb().slice(0, 10) });
    await ticket({ requester_id: requester.id, assignee_id: staff.id, status: "in_progress" });
    const mine = (await (await as(requester)).get("/api/v1/dashboard")).body.data;
    expect(mine.tickets).toMatchObject({ open: 2, waiting_me: 0, to_close: 1, recent_scope: "mine" });
    expect(mine.tickets.recent).toHaveLength(2);
    expect(mine.it).toBeNull();
    expect(mine.leave_balance.map((b: { type: string }) => b.type)).toContain("sick");
    const it_ = (await (await as(staff)).get("/api/v1/dashboard")).body.data;
    expect(it_.it).toMatchObject({ in_progress: 1, done_month: 1 });
    expect(it_.tickets.open).toBe(0);
    // ฝ่าย IT: ใบแจ้งงานล่าสุดของทั้งฝ่าย (ไม่ใช่เฉพาะที่ตัวเองแจ้ง)
    expect(it_.tickets.recent_scope).toBe("all");
    expect(it_.tickets.recent.length).toBeGreaterThanOrEqual(2);
  });

  it("text search matches every word anywhere in the request (fields, people, branch, subject)", async () => {
    const requester = await makeUser({ name: "สมหญิง ใจดี" });
    const staff = await makeUser({ is_it_staff: true, name: "ช่างเอก" });
    const a = await ticket({ type: "repair", type_other: null, requester_id: requester.id, assignee_id: staff.id, details: "ปริ้นเตอร์ชั้น 3", symptom: "กระดาษติด", device_name: "EPSON L3210" });
    const b = await ticket({ type: "install", type_other: null, requester_id: requester.id, assignee_id: staff.id, details: "ติดตั้งโปรแกรม PDF" });
    const api = await as(staff);
    const ids = async (q: string) => ((await api.get(`/api/v1/tickets?scope=all&per_page=100&search=${encodeURIComponent(q)}`)).body.data as { id: string }[]).map((x) => x.id);
    expect(await ids("กระดาษติด")).toEqual([a.uuid]);
    expect(await ids("epson")).toEqual([a.uuid]);
    expect((await ids("สมหญิง")).sort()).toEqual([a.uuid, b.uuid].sort());
    expect(await ids("ติดตั้ง")).toEqual([b.uuid]);
    expect(await ids("ชั้น")).toEqual([a.uuid]);
    expect(await ids("ซ่อม")).toEqual([a.uuid]);
    expect(await ids("ซ่อม ชั้น")).toEqual([a.uuid]);
    expect(await ids("ซ่อม PDF")).toEqual([]);
  });

  it("a repair that cannot be done needs only a reason (or 'cancelled by the requester'), and its documents show on the history entry", async () => {
    const staff = await makeUser({ is_it_staff: true });
    const t = await ticket({ type: "repair", type_other: null, requester_id: (await makeUser()).id, assignee_id: staff.id, accepted_at: nowDb() });
    const api = await as(staff);
    const post = () => api.post(`/api/v1/tickets/${t.uuid}/result`).field("result", "cannot_complete").field("signature", SIG);

    // ไม่มีสาเหตุ = 422 (ไม่ต้องกรอกวิธีซ่อม/การรับประกัน)
    const noReason = await post();
    expect(noReason.status).toBe(422);
    expect(Object.keys(noReason.body.errors)).toEqual(["cannot_reason"]);
    // ไฟล์เกิน 1MB = 422
    expect((await post().field("cannot_reason", "อะไหล่ไม่มี").attach("documents[]", fakePdf(1100), "big.pdf")).status).toBe(422);

    const res = await post()
      .field("cannot_reason", "อะไหล่เลิกผลิต")
      .field("repair_method", "external")
      .attach("documents[]", fakePdf(300), "ใบเสนอราคา.pdf")
      .attach("documents[]", fakeImage(100), "po.jpg");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({ result: "cannot_complete", cannot_reason: "อะไหล่เลิกผลิต", repair_method: null, warranty: null });
    const ev = d.events.find((e: { action: string }) => e.action === "resulted");
    expect(ev.comment).toBe("อะไหล่เลิกผลิต");
    expect(ev.attachments.map((a: { name: string; kind: string }) => [a.name, a.kind])).toEqual([["ใบเสนอราคา.pdf", "result_document"], ["po.jpg", "result_document"]]);
    expect((await api.get(`/api/v1${ev.attachments[0].url}`)).status).toBe(200);

    // ผู้แจ้งงานยกเลิก: สาเหตุตั้งให้อัตโนมัติ และไม่รับเอกสารประกอบ
    await (await as(await makeUser({ is_it_head: true, is_it_staff: true }))).post(`/api/v1/tickets/${t.uuid}/return`).send({ comment: "แก้ไข" });
    const cancelled = await post().field("requester_cancelled", "1").attach("documents[]", fakePdf(100), "x.pdf");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cannot_reason).toBe("ผู้แจ้งงานยกเลิก");
    const last = [...cancelled.body.data.events].reverse().find((e: { action: string }) => e.action === "resulted");
    expect(last.comment).toBe("ผู้แจ้งงานยกเลิก");
    expect(last.attachments).toEqual([]);
  });

  it("progress updates can carry files (e.g. a revised quotation or PO) shown on that history entry", async () => {
    const staff = await makeUser({ is_it_staff: true });
    const t = await ticket({ requester_id: (await makeUser()).id, assignee_id: staff.id, accepted_at: nowDb() });
    const api = await as(staff);
    const res = await api
      .post(`/api/v1/tickets/${t.uuid}/progress`)
      .field("comment", "อัปเดตใบเสนอราคา")
      .attach("files[]", fakePdf(200), "quote-v2.pdf")
      .attach("files[]", fakeImage(50, "png"), "รูป.png");
    expect(res.status).toBe(200);
    const ev = res.body.data.events.find((e: { action: string }) => e.action === "progress");
    expect(ev.attachments.map((a: { name: string }) => a.name)).toEqual(["quote-v2.pdf", "รูป.png"]);
    expect(res.body.data.attachments.filter((a: { event_id: number }) => a.event_id === ev.id)).toHaveLength(2);
    // ไม่มีไฟล์ (JSON) ยังใช้ได้ / ไฟล์เกิน 1MB = 422
    expect((await api.post(`/api/v1/tickets/${t.uuid}/progress`).send({ comment: "รออะไหล่" })).status).toBe(200);
    expect((await api.post(`/api/v1/tickets/${t.uuid}/progress`).field("comment", "x").attach("files[]", fakePdf(1100), "big.pdf")).status).toBe(422);
  });
});
