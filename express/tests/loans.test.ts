import { describe, expect, it } from "vitest";
import { exec, scalar } from "../src/db.js";
import { notifyOverdueLoans } from "../src/routes/loans.js";
import { as, day, makeAsset, makeUser } from "./helpers.js";

/** ยืมอุปกรณ์ IT — อุปกรณ์ = สินทรัพย์ที่เจ้าหน้าที่ IT ถือครอง, จอง → ส่งมอบ → รับคืน, แจ้งเตือนเกินกำหนด */

const loan = (asset_id: number, extra: Record<string, unknown> = {}) => ({
  asset_id, purpose: "นำเสนองานลูกค้า", start_on: day(1), start_time: "09:00", end_on: day(2), end_time: "17:00", ...extra,
});
const notices = (userId: number, type: string) =>
  scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ? AND read_at IS NULL", [userId, type]).then(Number);

describe("IT equipment loans", () => {
  it("only assets held by IT staff can be borrowed; bookings cannot overlap; managers are told about new requests", async () => {
    const itStaff = await makeUser({ name: "เจ้าหน้าที่ IT", is_it_staff: true });
    const manager = await makeUser({ role: "admin", name: "ผู้ดูแลอุปกรณ์" });
    const borrowerUser = await makeUser({ name: "ผู้ยืม", department: "ขาย" });
    const projector = await makeAsset({ name: "Projector", custodian_id: itStaff.id });
    const notIt = await makeAsset({ name: "เครื่องของพนักงาน", custodian_id: borrowerUser.id });
    const disposed = await makeAsset({ name: "เครื่องจำหน่ายแล้ว", custodian_id: itStaff.id, status: "disposed" });
    const borrower = await as(borrowerUser, "th");

    const devices = (await borrower.get("/api/v1/loan-devices")).body.data.map((d: { id: number }) => d.id);
    expect(devices).toContain(projector.id);
    expect(devices).not.toContain(notIt.id);
    expect(devices).not.toContain(disposed.id);

    expect((await borrower.post("/api/v1/loans").send(loan(notIt.id))).status).toBe(422);
    expect((await borrower.post("/api/v1/loans").send(loan(projector.id, { end_on: day(1), end_time: "08:00" }))).status).toBe(422);
    const created = await borrower.post("/api/v1/loans").send(loan(projector.id));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "reserved", department: "ขาย", asset: { id: projector.id }, can_edit: true, can_hand_out: false });
    expect(await notices(manager.id, "loan.requested")).toBe(1);
    // ช่วงซ้อนกัน = 422, ต่อกันพอดีขอบเวลาได้
    const clash = await borrower.post("/api/v1/loans").send(loan(projector.id, { start_on: day(2), start_time: "10:00", end_on: day(3) }));
    expect(clash.status).toBe(422);
    expect((await borrower.post("/api/v1/loans").send(loan(projector.id, { start_on: day(2), start_time: "17:00", end_on: day(3) }))).status).toBe(201);
    // ปฏิทินเห็นทุกคน
    expect((await (await as(itStaff)).get(`/api/v1/loans?from=${day(0)}&to=${day(5)}`)).body.data).toHaveLength(2);
  });

  it("managers hand over and receive; overdue loans notify the borrower and managers once a day; history stays", async () => {
    const itStaff = await makeUser({ is_it_staff: true });
    const managerUser = await makeUser({ role: "admin", name: "ผู้ดูแลอุปกรณ์" });
    const borrowerUser = await makeUser({ name: "ผู้ยืม" });
    const otherUser = await makeUser({ name: "คนถัดไป" });
    const notebook = await makeAsset({ name: "Notebook สำรอง", custodian_id: itStaff.id });
    const [borrower, manager, other] = [await as(borrowerUser, "th"), await as(managerUser, "th"), await as(otherUser, "th")];

    const first = (await borrower.post("/api/v1/loans").send(loan(notebook.id, { start_on: day(0), start_time: "00:00", end_on: day(1), end_time: "09:00" }))).body.data;
    const next = (await other.post("/api/v1/loans").send(loan(notebook.id, { start_on: day(3), end_on: day(4) }))).body.data;
    expect((await manager.get("/api/v1/menu-badges")).body.data["/loans/manage"]).toBe(1); // ถึงวันรับแล้ว 1 รายการ
    expect((await manager.get("/api/v1/loans/manage?status=pending")).body.data).toHaveLength(2);

    // ส่งมอบ: ผู้จัดการเท่านั้น → ผู้ยืมได้แจ้งเตือน, "รอส่งมอบ" ของผู้จัดการปิด
    expect((await borrower.post(`/api/v1/loans/${first.id}/hand-out`)).status).toBe(403);
    const out = await manager.post(`/api/v1/loans/${first.id}/hand-out`);
    expect(out.body.data).toMatchObject({ status: "on_loan", handed_out_by: "ผู้ดูแลอุปกรณ์", can_edit: false, can_cancel: false, can_return: true });
    expect(await notices(borrowerUser.id, "loan.handed_out")).toBe(1);
    expect((await borrower.post(`/api/v1/loans/${first.id}/cancel`)).status).toBe(422);
    // ยังไม่คืน → ส่งมอบให้คนถัดไปไม่ได้
    expect((await manager.post(`/api/v1/loans/${next.id}/hand-out`)).status).toBe(422);

    // เลยกำหนดคืน → แจ้งผู้ยืม + ผู้จัดการ วันละครั้ง
    await exec("UPDATE equipment_loans SET end_on = ?, end_time = '08:00' WHERE uuid = ?", [day(-1), first.id]);
    expect(await notifyOverdueLoans()).toBe(1);
    expect(await notifyOverdueLoans()).toBe(0);
    expect(await notices(borrowerUser.id, "loan.overdue")).toBe(1);
    expect(await notices(managerUser.id, "loan.overdue")).toBe(1);
    expect((await borrower.get("/api/v1/menu-badges")).body.data["/loans/mine"]).toBe(1);
    expect((await borrower.get("/api/v1/loans/mine")).body.data[0]).toMatchObject({ id: first.id, is_overdue: true });
    expect((await manager.get("/api/v1/loans/manage?status=overdue")).body.data.map((l: { id: string }) => l.id)).toEqual([first.id]);

    // รับคืน → แจ้งเตือนเกินกำหนดหมดหน้าที่, ส่งมอบคนถัดไปได้
    const back = await manager.post(`/api/v1/loans/${first.id}/return`).send({ note: "สภาพดี" });
    expect(back.body.data).toMatchObject({ status: "returned", return_note: "สภาพดี", is_overdue: false });
    expect(await notices(borrowerUser.id, "loan.overdue")).toBe(0);
    expect(await notices(managerUser.id, "loan.overdue")).toBe(0);
    expect((await borrower.get("/api/v1/menu-badges")).body.data["/loans/mine"]).toBe(0);
    expect((await borrower.get("/api/v1/loans/mine?status=past")).body.data.map((l: { id: string }) => l.id)).toEqual([first.id]);
    expect((await manager.post(`/api/v1/loans/${next.id}/hand-out`)).status).toBe(200);

    // ผู้ยืมยกเลิกของตัวเองได้ระหว่างยังไม่ส่งมอบ / คนอื่นยกเลิกไม่ได้
    const mine = (await borrower.post("/api/v1/loans").send(loan(notebook.id, { start_on: day(10), end_on: day(11) }))).body.data;
    expect((await other.post(`/api/v1/loans/${mine.id}/cancel`)).status).toBe(403);
    expect((await borrower.post(`/api/v1/loans/${mine.id}/cancel`)).body.data.status).toBe("cancelled");
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'equipment_loan.%'").then(Number)).toBeGreaterThanOrEqual(6);
  });
});
