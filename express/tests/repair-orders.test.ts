import { describe, expect, it } from "vitest";
import { first, insert, scalar, update } from "../src/db.js";
import { nowDb } from "../src/lib/time.js";
import { as, day, makeUser, realImage, SIG } from "./helpers.js";

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

  it("keeps a map link (http/https only) and company files, IT-only", async () => {
    const staff = await as(await makeUser({ role: "admin", is_it_staff: true }));
    const viewer = await as(await makeUser());

    expect((await staff.post("/api/v1/vendors").send({ ...VENDOR, name: "Vendor Map X", map_url: "javascript:alert(1)" })).body.errors.map_url).toBeTruthy();

    const field = (req: ReturnType<typeof staff.post>, fields: Record<string, string>) => {
      for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
      return req;
    };
    const created = await field(staff.post("/api/v1/vendors"), { ...VENDOR, name: "Vendor Files", map_url: "https://maps.app.goo.gl/abc", is_active: "1" }).attach("files[]", await realImage(800, 300, "png"), "company.png");
    expect(created.status).toBe(201);
    expect(created.body.data.map_url).toBe("https://maps.app.goo.gl/abc");
    expect(created.body.data.files.map((f: { name: string }) => f.name)).toEqual(["company.png"]);
    const { id, files } = created.body.data as { id: number; files: { id: number; url: string }[] };

    expect((await staff.get(`/api/v1${files[0].url}`)).status).toBe(200);
    expect((await viewer.get(`/api/v1${files[0].url}`)).status).toBe(403);
    expect((await staff.get(`/api/v1/vendors/${id}/files/999999`)).status).toBe(404);
    expect((await staff.get("/api/v1/vendors")).body.data.find((v: { id: number }) => v.id === id).files).toHaveLength(1);

    // เพิ่มไฟล์ใหม่ + เอาไฟล์เดิมออก / ล้างลิงก์
    const updated = await field(staff.put(`/api/v1/vendors/${id}`), { ...VENDOR, name: "Vendor Files", map_url: "", "remove_file_ids[]": String(files[0].id) }).attach("files[]", await realImage(800, 300, "png"), "new.png");
    expect(updated.status).toBe(200);
    expect(updated.body.data.map_url).toBeNull();
    expect(updated.body.data.files.map((f: { name: string }) => f.name)).toEqual(["new.png"]);

    // ไฟล์ของ Vendor อื่นเปิด/ลบผ่านรายการนี้ไม่ได้
    const other = await makeVendor(staff, "Vendor Other");
    expect((await staff.get(`/api/v1/vendors/${other.id}/files/${updated.body.data.files[0].id}`)).status).toBe(404);
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

    // ตัวเลขเมนู + แท็บ = รายการที่ถึงกำหนดตามงานแล้ว (ส่งวันนี้ ตั้งต้น 7 วัน = ยังไม่ถึง) — ผู้ไม่มีสิทธิ์ไม่มีตัวเลข
    const badges = await staff.get("/api/v1/menu-badges");
    expect(badges.body.data["/it/repair-orders"]).toBe(0);
    expect((await requesterApi.get("/api/v1/menu-badges")).body.data["/it/repair-orders"]).toBeUndefined();

    // รับคืน: ผู้ไม่มีสิทธิ์ทำไม่ได้ / ทำได้ครั้งเดียว
    expect((await requesterApi.post(`/api/v1/repair-orders/${orderId}/return`).field("return_note", "x")).status).toBe(403);
    const back = await staff.post(`/api/v1/repair-orders/${orderId}/return`).field("return_note", "เปลี่ยนเมนบอร์ด").attach("files[]", await realImage(800, 300, "png"), "back.png");
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: "returned", return_note: "เปลี่ยนเมนบอร์ด", can_return: false, received_by: { id: it2.id } });
    expect(back.body.data.files.map((f: { kind: string }) => f.kind)).toEqual(["send", "return"]);
    expect((await staff.post(`/api/v1/repair-orders/${orderId}/return`)).status).toBe(422);

    expect(eventOf((await staff.get(`/api/v1/tickets/${t.uuid}`)).body, "repair_returned")?.repair_order_id).toBe(orderId);
    expect(Number(await notices(requester.id, "repair_returned"))).toBe(1);
    expect(Number((await staff.get("/api/v1/menu-badges")).body.data["/it/repair-orders"])).toBe(0);
    expect((await first<{ status: string }>("SELECT status FROM it_tickets WHERE id = ?", [t.id]))?.status).toBe("in_progress");
  });

  it("item details and document number are optional, saved, editable and searchable", async () => {
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const v = await makeVendor(staff, "Vendor Doc");
    const now = nowDb();
    const uuid = crypto.randomUUID();
    await insert("assets", { uuid, asset_tag: "HOST-DOC-1", name: "PC เอกสาร", category: "COMPUTER", status: "active", created_at: now, updated_at: now });
    const base = { asset: uuid, symptom: "จอดับ", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id };

    // ไม่กรอกได้
    const bare = await send(staff, base);
    expect(bare.status).toBe(201);
    expect(bare.body.data).toMatchObject({ item_details: null, document_no: null });
    expect((await staff.post(`/api/v1/repair-orders/${bare.body.data.id}/cancel`).send({ reason: "x" })).status).toBe(200);

    expect((await send(staff, { ...base, document_no: "x".repeat(101) })).body.errors.document_no).toBeTruthy();
    const res = await send(staff, { ...base, item_details: "พร้อมสายชาร์จและกระเป๋า", document_no: "RP-2569-001" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ item_details: "พร้อมสายชาร์จและกระเป๋า", document_no: "RP-2569-001" });
    const id = res.body.data.id as string;

    expect((await staff.get("/api/v1/repair-orders?status=sent&search=RP-2569-001")).body.data.map((r: { id: string }) => r.id)).toEqual([id]);

    // แก้เป็นค่าใหม่ / ส่งว่าง = ล้าง
    const edit = (fields: Record<string, string | number>) => {
      let req = staff.put(`/api/v1/repair-orders/${id}`);
      for (const [k, val] of Object.entries({ symptom: "จอดับ", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id, ...fields })) req = req.field(k, String(val));
      return req;
    };
    expect((await edit({ item_details: "สายชาร์จ", document_no: "RP-2" })).body.data).toMatchObject({ item_details: "สายชาร์จ", document_no: "RP-2" });
    expect((await edit({ item_details: "", document_no: "" })).body.data).toMatchObject({ item_details: null, document_no: null });
  });

  it("serial number comes from the asset when it has one, otherwise it can be typed", async () => {
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const v = await makeVendor(staff, "Vendor Serial");
    const now = nowDb();
    const withSn = crypto.randomUUID();
    const noSn = crypto.randomUUID();
    await insert("assets", { uuid: withSn, asset_tag: "HOST-SN-1", name: "PC มี SN", model: "M1", serial_number: "SN-ASSET", category: "COMPUTER", status: "active", created_at: now, updated_at: now });
    await insert("assets", { uuid: noSn, asset_tag: "HOST-SN-2", name: "PC ไม่มี SN", category: "COMPUTER", status: "active", created_at: now, updated_at: now });
    const base = { symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id };

    // มี S/N ที่สินทรัพย์ = ค่าที่ส่งมาไม่นับ
    const a = await send(staff, { ...base, asset: withSn, serial_number: "TYPED" });
    expect(a.body.data).toMatchObject({ serial_number: "SN-ASSET", item_serial: null, serial_from_asset: true, model: "M1", item_name: "PC มี SN" });

    // ไม่มี = เก็บที่กรอกไว้กับรายการส่งซ่อม ไม่เขียนกลับสินทรัพย์
    const b = await send(staff, { ...base, asset: noSn, serial_number: "SN-TYPED" });
    expect(b.body.data).toMatchObject({ serial_number: "SN-TYPED", item_serial: "SN-TYPED", serial_from_asset: false });
    expect(await scalar("SELECT serial_number FROM assets WHERE uuid = ?", [noSn])).toBeNull();
    expect((await staff.get("/api/v1/repair-orders?status=sent&search=SN-TYPED")).body.data.map((r: { id: string }) => r.id)).toEqual([b.body.data.id]);

    const edit = await staff.put(`/api/v1/repair-orders/${b.body.data.id}`).field("symptom", "x").field("vendor_id", String(v.id)).field("sent_on", day(0)).field("sent_time", "08:00").field("sent_by_id", String(it1.id)).field("serial_number", "SN-NEW");
    expect(edit.body.data.serial_number).toBe("SN-NEW");
  });

  it("the form lists open repair tickets, including ones already out for repair", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const staff = await as(it1);
    const v = await makeVendor(staff, "Vendor Open");
    const accepted = await inProgressTicket(requester.id, it1.id);
    const waiting = await inProgressTicket(requester.id, it1.id, { status: "approved" });
    const review = await inProgressTicket(requester.id, it1.id, { status: "pending_it_head" });
    const closed = await inProgressTicket(requester.id, it1.id, { status: "completed" });
    const cancelled = await inProgressTicket(requester.id, it1.id, { status: "cancelled" });
    const preApproval = await inProgressTicket(requester.id, it1.id, { status: "pending_supervisor" });
    const otherType = await inProgressTicket(requester.id, it1.id, { type: "install" });
    const options = async () => ((await staff.get("/api/v1/repair-orders/form-options")).body.data.tickets as { ticket_id: string }[]).map((x) => x.ticket_id);

    const open = await options();
    expect(open).toEqual(expect.arrayContaining([accepted.uuid, waiting.uuid, review.uuid]));
    for (const x of [closed, cancelled, preApproval, otherType]) expect(open).not.toContain(x.uuid);

    // ส่งได้ทุกใบที่ยังไม่ปิด — ใบที่ส่งซ่อมอยู่ยังเลือกได้ (ส่งเพิ่มอีกรายการ)
    const sent = await send(staff, { ticket: waiting.uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id });
    expect(sent.status).toBe(201);
    expect(await options()).toContain(waiting.uuid);
    expect((await send(staff, { ticket: preApproval.uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).body.errors.item).toBeTruthy();
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
    // เครื่องเดียวกันส่งเพิ่มได้ — รับคืนรายการแรกแล้วเครื่องยังส่งซ่อมอยู่จนรายการที่สองกลับมา
    const second = await send(staff, { asset: uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id });
    expect(second.status).toBe(201);
    await staff.post(`/api/v1/repair-orders/${second.body.data.id}/return`);
    expect((await first<{ status: string }>("SELECT status FROM assets WHERE uuid = ?", [uuid]))?.status).toBe("in_repair");
    await staff.post(`/api/v1/repair-orders/${res.body.data.id}/return`);
    expect((await first<{ status: string }>("SELECT status FROM assets WHERE uuid = ?", [uuid]))?.status).toBe("active");

    const closed = await inProgressTicket(requester.id, it1.id, { status: "completed" });
    expect((await send(staff, { ticket: closed.uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).body.errors.item).toBeTruthy();
    // ผู้ตรวจสอบอ่านได้ บันทึกไม่ได้
    const auditor = await as(await makeUser({ role: "auditor" }));
    expect((await auditor.get("/api/v1/repair-orders?status=returned")).status).toBe(200);
    expect((await send(auditor, { asset: uuid, symptom: "x", vendor_id: v.id, sent_on: day(0), sent_time: "08:00", sent_by_id: it1.id })).status).toBe(403);
  });
});

describe("repair orders: device not in the system, typed sender, recorder", () => {
  it("sends a device that has no asset / ticket, sender typed or picked from users, recorder = creator", async () => {
    const it1 = await makeUser({ role: "admin", is_it_staff: true, name: "ผู้บันทึก IT" });
    const staff = await as(it1);
    const vendor = await makeVendor(staff, "ร้านซ่อมนอกระบบ");
    const base = { symptom: "จอไม่ติด", vendor_id: vendor.id, sent_on: day(0), sent_time: "09:00" };

    // ไม่ติ๊กอุปกรณ์นอกระบบ และไม่เลือกของ = ไม่ผ่าน; ติ๊กแต่ไม่มีชื่ออุปกรณ์ = ไม่ผ่าน; ไม่มีผู้ส่ง = ไม่ผ่าน
    expect((await send(staff, { ...base, sender_name: "ใครก็ได้" })).body.errors).toHaveProperty("item");
    expect((await send(staff, { ...base, manual: 1, sender_name: "ใครก็ได้" })).body.errors).toHaveProperty("item_name");
    expect((await send(staff, { ...base, manual: 1, item_name: "จอ" })).body.errors).toHaveProperty("sent_by_id");

    const typed = await send(staff, { ...base, manual: 1, item_name: "จอ Samsung 24 นิ้ว", item_details: "สีดำ มีรอยขีดข่วน", sender_name: "นายสมชาย เจ้าของเครื่อง" });
    expect(typed.status).toBe(201);
    expect(typed.body.data).toMatchObject({
      manual: true, asset_id: null, ticket: null, item_no: null, item_name: "จอ Samsung 24 นิ้ว", item_details: "สีดำ มีรอยขีดข่วน",
      sent_by: { id: null, name: "นายสมชาย เจ้าของเครื่อง" }, created_by: { id: it1.id, name: "ผู้บันทึก IT" },
    });

    const owner = await makeUser({ name: "เจ้าของในระบบ" });
    const picked = await send(staff, { ...base, manual: 1, item_name: "เครื่องพิมพ์", sent_by_id: owner.id, sender_name: "พิมพ์ไม่ตรง" });
    expect(picked.status).toBe(201);
    expect(picked.body.data.sent_by).toEqual({ id: owner.id, name: "เจ้าของในระบบ" }); // เลือกจากผู้ใช้ = ชื่อตามผู้ใช้

    const inactive = await makeUser({ name: "ปิดแล้ว", is_active: false });
    expect((await send(staff, { ...base, manual: 1, item_name: "x", sent_by_id: inactive.id })).body.errors).toHaveProperty("sent_by_id");

    // แก้ไข: ชื่ออุปกรณ์นอกระบบ + ผู้ส่งเปลี่ยนได้, ผู้บันทึกคงเดิม
    let req = staff.put(`/api/v1/repair-orders/${typed.body.data.id}`);
    for (const [k, v] of Object.entries({ ...base, item_name: "จอ Samsung 27 นิ้ว", sender_name: "นางสมหญิง" })) req = req.field(k, String(v));
    const edited = await req;
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ item_name: "จอ Samsung 27 นิ้ว", sent_by: { id: null, name: "นางสมหญิง" }, created_by: { id: it1.id } });

    // ค้นผู้ใช้สำหรับช่องผู้ส่งซ่อม
    const people = (await staff.get(`/api/v1/repair-orders/people?q=${encodeURIComponent("เจ้าของ")}`)).body.data;
    expect(people).toContainEqual({ id: owner.id, name: "เจ้าของในระบบ", department: null });
    expect((await (await as(await makeUser())).get("/api/v1/repair-orders/people?q=a")).status).toBe(403);
  });
});

describe("repair orders: follow-up reminder", () => {
  it("defaults to 7 days; when due the recorder gets one bell notice + menu/tab count, cleared by extending or receiving back", async () => {
    const { notifyRepairFollowUps } = await import("../src/routes/repair-orders.js");
    const recorder = await makeUser({ role: "admin", is_it_staff: true, name: "ผู้บันทึก" });
    const other = await makeUser({ role: "admin", is_it_staff: true, name: "IT อีกคน" });
    const api = await as(recorder);
    const vendor = await makeVendor(api, "ร้านตามงาน");
    const base = { manual: 1, item_name: "เครื่องสแกน", symptom: "ดึงกระดาษไม่เข้า", vendor_id: vendor.id, sent_time: "10:00", sender_name: "เจ้าของ" };

    const fresh = await send(api, { ...base, sent_on: day(0) });
    expect(fresh.body.data).toMatchObject({ follow_up_days: 7, follow_up_on: day(7), follow_up_due: false });
    expect((await send(api, { ...base, sent_on: day(0), follow_up_days: 0 })).body.errors).toHaveProperty("follow_up_days");

    const old = await send(api, { ...base, sent_on: day(-10) });
    expect(old.body.data).toMatchObject({ follow_up_on: day(-3), follow_up_due: true });
    const uuid = old.body.data.id;
    const badge = async (u: typeof recorder) => (await (await as(u)).get("/api/v1/menu-badges")).body.data["/it/repair-orders"] ?? 0;

    expect(await notifyRepairFollowUps()).toBeGreaterThanOrEqual(1);
    expect(await notices(recorder.id, "follow_up")).toBe(1);
    expect(await notices(other.id, "follow_up")).toBe(0); // ผู้บันทึกยังจัดการได้ = แจ้งเฉพาะผู้บันทึก
    await notifyRepairFollowUps(); // ครั้งเดียวต่อวันกำหนด
    expect(await notices(recorder.id, "follow_up")).toBe(1);
    expect(await badge(recorder)).toBe(1);
    expect(await badge(other)).toBe(0);
    expect((await api.get("/api/v1/repair-orders")).body.meta.counts.sent).toBe(1);

    // ขยายเป็น 30 วัน = ยังไม่ถึงกำหนด แจ้งเตือนเดิมอ่านแล้ว
    let req = api.put(`/api/v1/repair-orders/${uuid}`);
    for (const [k, v] of Object.entries({ symptom: "x", vendor_id: vendor.id, sent_on: day(-10), sent_time: "10:00", sender_name: "เจ้าของ", follow_up_days: 30 })) req = req.field(k, String(v));
    expect((await req).body.data).toMatchObject({ follow_up_days: 30, follow_up_due: false });
    expect(await badge(recorder)).toBe(0);
    expect(await scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND subject_ref = ? AND read_at IS NULL", [recorder.id, uuid])).toBe(0);

    // กลับเป็น 5 วัน = ถึงกำหนดใหม่ แจ้งอีกครั้ง → รับคืน = อ่านแล้ว + ตัวเลขหาย
    req = api.put(`/api/v1/repair-orders/${uuid}`);
    for (const [k, v] of Object.entries({ symptom: "x", vendor_id: vendor.id, sent_on: day(-10), sent_time: "10:00", sender_name: "เจ้าของ", follow_up_days: 5 })) req = req.field(k, String(v));
    await req;
    await notifyRepairFollowUps();
    expect(await scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND subject_ref = ? AND read_at IS NULL", [recorder.id, uuid])).toBe(1);
    expect((await api.post(`/api/v1/repair-orders/${uuid}/return`).field("return_note", "ok")).status).toBe(200);
    expect(await scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND subject_ref = ? AND read_at IS NULL", [recorder.id, uuid])).toBe(0);
    expect(await badge(recorder)).toBe(0);

    // ผู้บันทึกถูกปิดใช้งาน = แจ้งผู้มีสิทธิ์จัดการทุกคน
    const left = await makeUser({ role: "admin", is_it_staff: true });
    const byLeft = await send(await as(left), { ...base, sent_on: day(-8) });
    await update("users", { is_active: false }, "id = ?", [left.id]);
    await notifyRepairFollowUps();
    expect(await scalar<number>("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND subject_ref = ?", [other.id, byLeft.body.data.id])).toBe(1);
  });
});

describe("repair orders: pick in the ticket result form", () => {
  it("the assignee recording the result sees this ticket's repair / claim orders (not cancelled); others see none", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const vendor = await makeVendor(api, "ร้านเคลมในใบงาน");
    const t = await inProgressTicket(requester.id, it1.id);
    const sent = await send(api, { ticket: t.uuid, symptom: "จอดับ", vendor_id: vendor.id, sent_on: day(-2), sent_time: "09:00", sender_name: "เจ้าของ", document_no: "DOC-77" });
    expect(sent.status).toBe(201);
    await api.post(`/api/v1/repair-orders/${sent.body.data.id}/return`).field("return_note", "เปลี่ยนจอใหม่");

    const detail = (await api.get(`/api/v1/tickets/${t.uuid}`)).body.data;
    expect(detail.repair_order_options).toEqual([
      expect.objectContaining({ id: sent.body.data.id, vendor: "ร้านเคลมในใบงาน", document_no: "DOC-77", symptom: "จอดับ", return_note: "เปลี่ยนจอใหม่", status: "returned", sent_on: day(-2) }),
    ]);
    // ผู้แจ้ง (บันทึกผลไม่ได้) ไม่ได้รายการ
    expect((await (await as(requester)).get(`/api/v1/tickets/${t.uuid}`)).body.data.repair_order_options).toEqual([]);
  });
});

describe("repair orders: parts replaced + ticket progress", () => {
  it("receiving back saves the parts the shop replaced (blank rows skipped) and offers them to the ticket result", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const vendor = await makeVendor(api, "ร้านเปลี่ยนอะไหล่");
    const t = await inProgressTicket(requester.id, it1.id);
    const sent = await send(api, { ticket: t.uuid, symptom: "เปิดไม่ติด", vendor_id: vendor.id, sent_on: day(-1), sent_time: "10:00", sender_name: "เจ้าของ" });
    const back = await api
      .post(`/api/v1/repair-orders/${sent.body.data.id}/return`)
      .field("parts[0][name]", "เมนบอร์ด")
      .field("parts[0][quantity]", "1")
      .field("parts[1][name]", " ")
      .field("parts[2][name]", "RAM 8GB")
      .field("parts[2][quantity]", "2");
    expect(back.status).toBe(200);
    expect(back.body.data.parts).toEqual([
      { name: "เมนบอร์ด", quantity: 1 },
      { name: "RAM 8GB", quantity: 2 },
    ]);
    const option = (await api.get(`/api/v1/tickets/${t.uuid}`)).body.data.repair_order_options[0];
    expect(option).toMatchObject({ id: sent.body.data.id, own: true, parts: [{ name: "เมนบอร์ด", quantity: 1 }, { name: "RAM 8GB", quantity: 2 }] });
    // แบบฟอร์มพิมพ์ของผู้แจ้งก็ได้อะไหล่จากการรับคืน
    expect((await (await as(requester)).get(`/api/v1/tickets/${t.uuid}`)).body.data.repair_parts).toEqual([
      { name: "เมนบอร์ด", quantity: 1 },
      { name: "RAM 8GB", quantity: 2 },
    ]);
  });

  it("a progress update can reference this ticket's repair order (IT-only link); another ticket's order is refused", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const vendor = await makeVendor(api, "ร้านแจ้งความคืบหน้า");
    const t = await inProgressTicket(requester.id, it1.id);
    const other = await inProgressTicket(requester.id, it1.id);
    const sent = await send(api, { ticket: t.uuid, symptom: "จอดับ", vendor_id: vendor.id, sent_on: day(0), sent_time: "09:00", sender_name: "เจ้าของ" });
    const otherSent = await send(api, { ticket: other.uuid, symptom: "จอดับ", vendor_id: vendor.id, sent_on: day(0), sent_time: "09:00", sender_name: "เจ้าของ" });

    const bad = await api.post(`/api/v1/tickets/${t.uuid}/progress`).field("comment", "ส่งซ่อม").field("repair_order_id", otherSent.body.data.id);
    expect(bad.status).toBe(422);
    const ok = await api.post(`/api/v1/tickets/${t.uuid}/progress`).field("comment", "ส่งซ่อมที่ร้านแล้ว").field("repair_order_id", sent.body.data.id);
    expect(ok.status).toBe(200);
    const ev = ok.body.data.events.find((e: { action: string }) => e.action === "progress");
    expect(ev).toMatchObject({ comment: "ส่งซ่อมที่ร้านแล้ว", repair_order_id: sent.body.data.id });
    // ผู้แจ้งเห็นข้อความ แต่ไม่เห็นลิงก์รายการส่งซ่อม
    const seen = (await (await as(requester)).get(`/api/v1/tickets/${t.uuid}`)).body.data.events.find((e: { action: string }) => e.action === "progress");
    expect(seen).toMatchObject({ comment: "ส่งซ่อมที่ร้านแล้ว", repair_order_id: null });
  });
});

describe("repair orders: sender defaults to the ticket requester", () => {
  it("ticket options and lookup carry the requester (id + name); assets carry none", async () => {
    const requester = await makeUser({ name: "ผู้แจ้งส่งซ่อม" });
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const t = await inProgressTicket(requester.id, it1.id);
    const options = (await api.get("/api/v1/repair-orders/form-options")).body.data.tickets as { ticket_id: string; requester: unknown }[];
    expect(options.find((o) => o.ticket_id === t.uuid)?.requester).toEqual({ id: requester.id, name: "ผู้แจ้งส่งซ่อม" });
  });
});

describe("repair orders: result needs the device back", () => {
  it("recording the ticket result is refused while its repair order is still out; allowed after receiving back", async () => {
    const requester = await makeUser();
    const it1 = await makeUser({ role: "admin", is_it_staff: true });
    const api = await as(it1);
    const vendor = await makeVendor(api, "ร้านยังไม่คืน");
    const t = await inProgressTicket(requester.id, it1.id);
    const sent = await send(api, { ticket: t.uuid, symptom: "เปิดไม่ติด", vendor_id: vendor.id, sent_on: day(0), sent_time: "09:00", sender_name: "เจ้าของ" });
    const result = () =>
      api.post(`/api/v1/tickets/${t.uuid}/result`).send({ result: "completed", completed_on: day(0), repair_method: "external", external_vendor: "ร้านยังไม่คืน", warranty: "out_of_warranty", signature: SIG });

    // ส่งเคลมอีกร้านจากใบเดียวกัน → การ์ด 1.2 แสดงทั้งสองรายการ
    const vendor2 = await makeVendor(api, "ร้านเคลมที่สอง");
    const claim = await send(api, { ticket: t.uuid, symptom: "เคลมจอ", vendor_id: vendor2.id, sent_on: day(0), sent_time: "10:00", sender_name: "เจ้าของ" });
    expect(claim.status).toBe(201);
    const listed = (await api.get(`/api/v1/tickets/${t.uuid}`)).body.data.repair_orders as { id: string; vendor: string; status: string }[];
    expect(listed.map((o) => o.id).sort()).toEqual([sent.body.data.id, claim.body.data.id].sort());
    expect((await (await as(requester)).get(`/api/v1/tickets/${t.uuid}`)).body.data.repair_orders).toEqual([]);
    await api.post(`/api/v1/repair-orders/${claim.body.data.id}/return`);

    const blocked = await result();
    expect(blocked.status).toBe(422);
    expect(String(blocked.body.errors.repair_order)).toContain("ร้านยังไม่คืน");

    await api.post(`/api/v1/repair-orders/${sent.body.data.id}/return`);
    expect((await result()).status).toBe(200);
  });
});
