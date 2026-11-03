import { describe, expect, it } from "vitest";
import { first, insert, scalar, update } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeUser, realImage } from "./helpers.js";

/** Vendor + รายการส่งซ่อม: ส่งซ่อม → ลงประวัติใบงาน + แจ้งเตือน → รับคืน; ลิงก์ในประวัติเห็นเฉพาะฝ่าย IT */

const VENDOR = { name: "ร้านซ่อมคอม", address: "กรุงเทพ", contact_name: "สมชาย", contact_phone: "0812345678", vendor_type: "ซ่อม" };
const notices = (userId: number, event: string) =>
  scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND data LIKE ?", [userId, `%"event":"${event}"%`]);

async function makeVendor(api: Awaited<ReturnType<typeof as>>, name = VENDOR.name) {
  const res = await api.post("/api/v1/vendors").send({ ...VENDOR, name });
  expect(res.status).toBe(201);
  return res.body.data as { id: number };
}

/** ใบแจ้งซ่อมที่เจ้าหน้าที่รับงานแล้ว */
async function inProgressTicket(requesterId: number, assigneeId: number, extra: Record<string, unknown> = {}) {
  const now = nowDb();
  const uuid = crypto.randomUUID();
  const id = await insert("it_tickets", {
    uuid,
    ticket_no: `FM-ITR-01-TEST-${uuid.slice(0, 8)}`,
    type: "repair",
    requester_id: requesterId,
    assignee_id: assigneeId,
    status: "in_progress",
    details: "แจ้งซ่อม",
    device_name: "Notebook Dell",
    asset_tag: "NO-MATCH",
    symptom: "เปิดไม่ติด",
    requested_at: now,
    created_at: now,
    updated_at: now,
    ...extra,
  });
  return { id, uuid };
}

const send = (api: Awaited<ReturnType<typeof as>>, fields: Record<string, string | number>) => {
  let req = api.post("/api/v1/repair-orders");
  for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
  return req;
};

describe("vendors", () => {
  it("requires the permission and every field except the tax id; deleting a used vendor is refused", async () => {
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const viewer = await as(await makeUser());

    expect((await viewer.get("/api/v1/vendors")).status).toBe(403);
    expect((await viewer.post("/api/v1/vendors").send(VENDOR)).status).toBe(403);

    const bad = await staff.post("/api/v1/vendors").send({ name: "x" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(["address", "contact_name", "contact_phone", "vendor_type"]));
    expect(Object.keys(bad.body.errors)).not.toContain("tax_id");

    const v = await makeVendor(staff, "Vendor A");
    expect((await staff.post("/api/v1/vendors").send({ ...VENDOR, name: "Vendor A" })).status).toBe(422);
    expect((await staff.put(`/api/v1/vendors/${v.id}`).send({ ...VENDOR, name: "Vendor A2", tax_id: "0105550000000" })).body.data.tax_id).toBe("0105550000000");

    const free = await makeVendor(staff, "Vendor B");
    expect((await staff.delete(`/api/v1/vendors/${free.id}`)).status).toBe(204);
    expect((await staff.get("/api/v1/vendors")).body.data.map((x: { name: string }) => x.name)).not.toContain("Vendor B");

    const now = nowDb();
    const assetId = await insert("assets", { uuid: crypto.randomUUID(), asset_tag: "VND-1", name: "PC", category: "COMPUTER", status: "active", created_at: now, updated_at: now });
    const assetUuid = await scalar<string>("SELECT uuid FROM assets WHERE id = ?", [assetId]);
    const sent = await send(staff, { asset: String(assetUuid), symptom: "จอดับ", vendor_id: v.id, sent_on: day(0), sent_time: "09:00", sent_by_id: it1.id });
    expect(sent.status).toBe(201);
    expect((await staff.delete(`/api/v1/vendors/${v.id}`)).status).toBe(422);
  });

  it("vendor types come from the dropdown list and renaming updates vendors", async () => {
    const staff = await as(await makeUser({ role: "admin", is_it_staff: true }));
    const custom = await staff.post("/api/v1/dropdown-options/vendor_type").send({ name: "ประเภททดสอบ" });
    expect(custom.status).toBe(201);
    const v = await staff.post("/api/v1/vendors").send({ ...VENDOR, name: "Vendor Rename", vendor_type: "ประเภททดสอบ" });
    await staff.put(`/api/v1/dropdown-options/vendor_type/${custom.body.data.id}`).send({ name: "ประเภทใหม่" });
    expect((await staff.get("/api/v1/dropdown-options/vendor_type")).body.data.map((o: { name: string }) => o.name)).toContain("ประเภทใหม่");
    expect((await staff.get(`/api/v1/vendors/${v.body.data.id}`)).body.data.vendor_type).toBe("ประเภทใหม่");
  });
});

describe("repair orders", () => {
  it("from a ticket: logs progress with an IT-only link, notifies, then receiving back logs and notifies again", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const it2 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it2);
    const requesterApi = await as(requester);
    const v = await makeVendor(staff, "Vendor Ticket");
    const t = await inProgressTicket(requester.id, it1.id);

    // ค้นจากเลขที่ใบแจ้งงาน → ดึงอาการจากใบ
    const no = await scalar<string>("SELECT ticket_no FROM it_tickets WHERE id = ?", [t.id]);
    const found = await staff.get(`/api/v1/repair-orders/lookup?q=${encodeURIComponent(String(no))}`);
    expect(found.body.data[0]).toMatchObject({ kind: "ticket", ticket_id: t.uuid, item_name: "Notebook Dell", symptom: "เปิดไม่ติด" });

    // บังคับอาการเสีย / ของที่ส่ง
    const noSymptom = await send(staff, { ticket: t.uuid, vendor_id: v.id, sent_on: day(0), sent_time: "09:00", sent_by_id: it2.id });
    expect(noSymptom.status).toBe(422);
    expect(noSymptom.body.errors.symptom).toBeTruthy();
    expect((await send(staff, { symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "09:00", sent_by_id: it2.id })).body.errors.item).toBeTruthy();

    const res = await send(staff, { ticket: t.uuid, symptom: "เปิดไม่ติด ไฟไม่เข้า", vendor_id: v.id, sent_on: day(0), sent_time: "09:30", sent_by_id: it2.id }).attach("files[]", await realImage(800, 300, "png"), "form.png");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "sent", symptom: "เปิดไม่ติด ไฟไม่เข้า", can_return: true, ticket: { id: t.uuid } });
    expect(res.body.data.files).toHaveLength(1);
    const orderId = res.body.data.id as string;

    // ใบเดิมยังไม่รับคืน = ส่งซ้ำไม่ได้
    expect((await send(staff, { ticket: t.uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "10:00", sent_by_id: it2.id })).status).toBe(422);

    // ประวัติใบงาน: ฝ่าย IT ได้ลิงก์ / ผู้แจ้งเห็นข้อความแต่ไม่มีลิงก์ และเปิดรายการส่งซ่อมไม่ได้
    const eventOf = (body: { data: { events: { action: string; repair_order_id: string | null; comment: string }[] } }, action: string) => body.data.events.find((e) => e.action === action);
    expect(eventOf((await staff.get(`/api/v1/tickets/${t.uuid}`)).body, "repair_sent")?.repair_order_id).toBe(orderId);
    const seen = eventOf((await requesterApi.get(`/api/v1/tickets/${t.uuid}`)).body, "repair_sent");
    expect(seen?.repair_order_id).toBeNull();
    expect(seen?.comment).toContain("Vendor Ticket");
    expect((await requesterApi.get(`/api/v1/repair-orders/${orderId}`)).status).toBe(403);
    expect((await requesterApi.get("/api/v1/repair-orders")).status).toBe(403);
    expect((await requesterApi.get(`/api/v1/repair-orders/${orderId}/files/${res.body.data.files[0].id}`)).status).toBe(403);
    expect((await staff.get(`/api/v1/repair-orders/${orderId}/files/${res.body.data.files[0].id}`)).status).toBe(200);

    // แจ้งเตือน: ผู้แจ้ง + ผู้รับงาน (ไม่แจ้งผู้กดเอง)
    expect(Number(await notices(requester.id, "repair_sent"))).toBe(1);
    expect(Number(await notices(it1.id, "repair_sent"))).toBe(1);
    expect(Number(await notices(it2.id, "repair_sent"))).toBe(0);

    // ตัวเลขเมนู + แท็บ = เครื่องที่รอรับคืน
    const badges = await staff.get("/api/v1/menu-badges");
    expect(badges.body.data["/it/repair-orders"]).toBeGreaterThanOrEqual(1);
    expect((await requesterApi.get("/api/v1/menu-badges")).body.data["/it/repair-orders"]).toBeUndefined();
    const pending = Number(badges.body.data["/it/repair-orders"]);

    // รับคืน: ผู้ไม่มีสิทธิ์ทำไม่ได้ / ทำได้ครั้งเดียว
    expect((await requesterApi.post(`/api/v1/repair-orders/${orderId}/return`).field("return_note", "x")).status).toBe(403);
    const back = await staff.post(`/api/v1/repair-orders/${orderId}/return`).field("return_note", "เปลี่ยนเมนบอร์ด").attach("files[]", await realImage(800, 300, "png"), "back.png");
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: "returned", return_note: "เปลี่ยนเมนบอร์ด", can_return: false, received_by: { id: it2.id } });
    expect(back.body.data.files.map((f: { kind: string }) => f.kind)).toEqual(["send", "return"]);
    expect((await staff.post(`/api/v1/repair-orders/${orderId}/return`)).status).toBe(422);

    expect(eventOf((await staff.get(`/api/v1/tickets/${t.uuid}`)).body, "repair_returned")?.repair_order_id).toBe(orderId);
    expect(Number(await notices(requester.id, "repair_returned"))).toBe(1);
    expect(Number((await staff.get("/api/v1/menu-badges")).body.data["/it/repair-orders"])).toBe(pending - 1);
    expect((await first<{ status: string }>("SELECT status FROM it_tickets WHERE id = ?", [t.id]))?.status).toBe("in_progress");
  });

  it("sending marks the asset as in repair; receiving back and cancelling restore its previous status", async () => {
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const v = await makeVendor(staff, "Vendor Status");
    const now = nowDb();
    const uuid = crypto.randomUUID();
    const assetId = await insert("assets", { uuid, asset_tag: "HOST-ST-1", name: "PC สำรอง", category: "COMPUTER", status: "in_storage", created_at: now, updated_at: now });
    const status = () => scalar<string>("SELECT status FROM assets WHERE id = ?", [assetId]);
    const sendIt = () => send(staff, { asset: uuid, symptom: "จอดับ", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id });

    const first1 = await sendIt();
    expect(first1.status).toBe(201);
    expect(await status()).toBe("in_repair");
    expect((await staff.post(`/api/v1/repair-orders/${first1.body.data.id}/return`)).status).toBe(200);
    expect(await status()).toBe("in_storage");

    // ยกเลิกต้องมีเหตุผล — ยกเลิกแล้วส่งใหม่ได้ และรายการยังอยู่ในแท็บยกเลิก
    const second = await sendIt();
    const secondId = second.body.data.id as string;
    expect((await staff.post(`/api/v1/repair-orders/${secondId}/cancel`).send({ reason: " " })).status).toBe(422);
    const cancelled = await staff.post(`/api/v1/repair-orders/${secondId}/cancel`).send({ reason: "บันทึกผิดเครื่อง" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: "cancelled", cancel_reason: "บันทึกผิดเครื่อง", can_return: false, cancelled_by: { id: it1.id } });
    expect(await status()).toBe("in_storage");
    expect((await staff.get("/api/v1/repair-orders?status=cancelled")).body.data.map((r: { id: string }) => r.id)).toContain(secondId);
    // จบแล้วทำซ้ำ / รับคืน / แก้ไขไม่ได้
    expect((await staff.post(`/api/v1/repair-orders/${secondId}/cancel`).send({ reason: "x" })).status).toBe(422);
    expect((await staff.post(`/api/v1/repair-orders/${secondId}/return`)).status).toBe(422);
    expect((await staff.put(`/api/v1/repair-orders/${secondId}`).send({ symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).status).toBe(422);

    // ระหว่างซ่อมมีคนเปลี่ยนสถานะเอง = รับคืนไม่ทับ
    const third = await sendIt();
    await update("assets", { status: "lost" }, "id = ?", [assetId]);
    await staff.post(`/api/v1/repair-orders/${third.body.data.id}/return`);
    expect(await status()).toBe("lost");
    // สูญหายแล้วส่งซ่อมไม่ได้
    expect((await sendIt()).body.errors.item).toBeTruthy();
  });

  it("editing updates the order, notifies only when the vendor or time changes, and cancelling from a ticket is logged", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const viewer = await as(requester);
    const v1 = await makeVendor(staff, "Vendor Edit 1");
    const v2 = await makeVendor(staff, "Vendor Edit 2");
    const t = await inProgressTicket(requester.id, it1.id);
    const sent = await send(staff, { ticket: t.uuid, symptom: "เดิม", vendor_id: v1.id, sent_on: day(0), sent_time: "09:00", sent_by_id: it1.id }).attach("files[]", await realImage(800, 300, "png"), "a.png");
    const id = sent.body.data.id as string;
    const fileId = sent.body.data.files[0].id as number;
    const put = (fields: Record<string, string | number>) => {
      let req = staff.put(`/api/v1/repair-orders/${id}`);
      for (const [k, val] of Object.entries(fields)) req = req.field(k, String(val));
      return req;
    };
    const base = { symptom: "แก้แล้ว", vendor_id: v1.id, sent_on: day(0), sent_time: "09:00", sent_by_id: it1.id };

    expect((await viewer.put(`/api/v1/repair-orders/${id}`).send(base)).status).toBe(403);
    expect((await viewer.post(`/api/v1/repair-orders/${id}/cancel`).send({ reason: "x" })).status).toBe(403);

    // แก้เฉพาะอาการ = ไม่ลงประวัติ/ไม่แจ้งเตือน
    expect((await put(base)).body.data.symptom).toBe("แก้แล้ว");
    expect(Number(await notices(requester.id, "repair_updated"))).toBe(0);

    // เปลี่ยน Vendor + ลบไฟล์ / เพิ่มไฟล์
    const changed = await put({ ...base, vendor_id: v2.id, "remove_file_ids[]": fileId }).attach("files[]", await realImage(800, 300, "png"), "b.png");
    expect(changed.status).toBe(200);
    expect(changed.body.data.vendor.id).toBe(v2.id);
    expect(changed.body.data.files.map((f: { name: string }) => f.name)).toEqual(["b.png"]);
    expect(Number(await notices(requester.id, "repair_updated"))).toBe(1);

    // เปลี่ยนไป Vendor ที่ปิดใช้งาน = ไม่ได้ / คง Vendor เดิมที่เพิ่งถูกปิด = ได้
    await update("vendors", { is_active: false }, "id = ?", [v1.id]);
    expect((await put({ ...base, vendor_id: v1.id })).body.errors.vendor_id).toBeTruthy();
    await update("vendors", { is_active: false }, "id = ?", [v2.id]);
    expect((await put({ ...base, vendor_id: v2.id })).status).toBe(200);

    const cancelled = await staff.post(`/api/v1/repair-orders/${id}/cancel`).send({ reason: "ลูกค้าเปลี่ยนใจ" });
    expect(cancelled.status).toBe(200);
    expect(Number(await notices(requester.id, "repair_cancelled"))).toBe(1);
    const events = (await staff.get(`/api/v1/tickets/${t.uuid}`)).body.data.events as { action: string; comment: string; repair_order_id: string | null }[];
    const log = events.find((e) => e.action === "repair_cancelled");
    expect(log?.comment).toContain("ลูกค้าเปลี่ยนใจ");
    expect(log?.repair_order_id).toBe(id);
    expect(events.filter((e) => e.action === "repair_updated")).toHaveLength(1);
  });

  it("from an asset without a ticket: no ticket event; tickets that are not repairs in progress cannot be sent", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const v = await makeVendor(staff, "Vendor Asset");
    const now = nowDb();
    const uuid = crypto.randomUUID();
    await insert("assets", { uuid, asset_tag: "HOST-RO-1", cpu_tag: "RO-0001", name: "PC บัญชี", category: "COMPUTER", status: "active", created_at: now, updated_at: now });

    const found = await staff.get("/api/v1/repair-orders/lookup?q=RO-0001");
    expect(found.body.data[0]).toMatchObject({ kind: "asset", asset_id: uuid, item_no: "RO-0001", item_name: "PC บัญชี", ticket_id: null });

    const res = await send(staff, { asset: uuid, symptom: "จอฟ้า", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ item_no: "RO-0001", ticket: null, asset_id: uuid });
    expect((await send(staff, { asset: uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).status).toBe(422);
    expect((await staff.post(`/api/v1/repair-orders/${res.body.data.id}/return`)).status).toBe(200);

    const closed = await inProgressTicket(requester.id, it1.id, { status: "completed" });
    expect((await send(staff, { ticket: closed.uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).body.errors.item).toBeTruthy();
    // ผู้ตรวจสอบอ่านได้ บันทึกไม่ได้
    const auditor = await as(await makeUser({ role: "auditor" }));
    expect((await auditor.get("/api/v1/repair-orders?status=returned")).status).toBe(200);
    expect((await send(auditor, { asset: uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).status).toBe(403);
  });
});
