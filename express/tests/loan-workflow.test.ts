import { describe, expect, it } from "vitest";
import { exec, scalar } from "../src/db.js";
import { notifyOverdueLoans } from "../src/routes/loans.js";
import { as, day, makeAsset, makeUser, realImage } from "./helpers.js";

/**
 * ยืมโน้ตบุ๊กแบบใหม่: ผู้ยืมขอโดยไม่เลือกเครื่อง → เจ้าหน้าที่ IT เตรียมเครื่อง (เลือกเครื่องที่ว่าง + อุปกรณ์เสริม + รูป)
 * → ผู้ยืมกดคืน (ไม่นับเกินกำหนด) → IT ยืนยันรับคืน + ตรวจอุปกรณ์เสริมครบ → เครื่องว่าง
 */
const request = (extra: Record<string, unknown> = {}) => ({ purpose: "ทำงานนอกสถานที่", start_on: day(0), start_time: "00:00", end_on: day(1), end_time: "17:00", ...extra });
const notices = (userId: number, type: string) =>
  scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ? AND read_at IS NULL", [userId, type]).then(Number);

describe("notebook loan workflow (request → prepare → return request → confirm)", () => {
  it("borrowers request without a device; IT picks a free device, accessories and photos; the borrower is notified and can no longer edit", async () => {
    const itStaff = await makeUser({ is_it_staff: true });
    const managerUser = await makeUser({ role: "admin", name: "เจ้าหน้าที่ยืม" });
    const borrowerUser = await makeUser({ name: "ผู้ขอยืม" });
    const otherUser = await makeUser({ name: "คนอื่น" });
    const nb1 = await makeAsset({ name: "Notebook A", custodian_id: itStaff.id, is_loanable: true });
    const nb2 = await makeAsset({ name: "Notebook B", custodian_id: itStaff.id, is_loanable: true });
    const [borrower, manager, other] = [await as(borrowerUser, "th"), await as(managerUser, "th"), await as(otherUser, "th")];

    const created = await borrower.post("/api/v1/loans").send(request());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "reserved", asset: null, accessories: [], can_edit: true, can_request_return: false });
    expect(await notices(managerUser.id, "loan.requested")).toBe(1);
    const id = created.body.data.id;

    // ทำให้ Notebook A ติดยืมอยู่ (คนอื่นยืมอยู่ช่วงซ้อน)
    const busy = (await other.post("/api/v1/loans").send(request({ asset_id: nb1.id }))).body.data;
    expect((await manager.post(`/api/v1/loans/${busy.id}/hand-out`).send({})).status).toBe(200);

    // ต้องเลือกเครื่อง / เครื่องที่ติดยืม = 422 / อุปกรณ์เสริมนอกรายการ = 422 / ผู้ยืมเตรียมเองไม่ได้
    expect((await manager.post(`/api/v1/loans/${id}/hand-out`).send({})).status).toBe(422);
    expect((await manager.post(`/api/v1/loans/${id}/hand-out`).send({ asset_id: nb1.id })).status).toBe(422);
    expect((await manager.post(`/api/v1/loans/${id}/hand-out`).send({ asset_id: nb2.id, accessories: ["laser"] })).status).toBe(422);
    expect((await borrower.post(`/api/v1/loans/${id}/hand-out`).send({ asset_id: nb2.id })).status).toBe(403);

    const out = await manager
      .post(`/api/v1/loans/${id}/hand-out`)
      .field("asset_id", String(nb2.id))
      .field("accessories[]", "charger")
      .field("accessories[]", "wireless_mouse")
      .attach("photos[]", await realImage(400, 300, "jpg", null), "nb.jpg");
    expect(out.status).toBe(200);
    expect(out.body.data).toMatchObject({ status: "on_loan", asset: { id: nb2.id }, can_edit: false, can_cancel: false, can_return: true });
    expect(out.body.data.accessories.sort()).toEqual(["charger", "wireless_mouse"]);
    expect(out.body.data.photos).toEqual([{ id: 1, stage: "hand_out" }]);
    expect(await notices(borrowerUser.id, "loan.handed_out")).toBe(1);
    expect(await notices(managerUser.id, "loan.requested")).toBe(0);

    // รูป: ผู้ยืม / ผู้จัดการ ดูได้ คนอื่นไม่ได้
    expect((await borrower.get(`/api/v1/loans/${id}/photos/1`)).status).toBe(200);
    expect((await other.get(`/api/v1/loans/${id}/photos/1`)).status).toBe(403);

    // รับเครื่องแล้ว: ผู้ยืมเห็นปุ่มคืน แก้ไข/ยกเลิกไม่ได้
    const mine = (await borrower.get(`/api/v1/loans/${id}`)).body.data;
    expect(mine).toMatchObject({ can_request_return: true, can_edit: false, can_cancel: false, can_return: false });
    expect((await borrower.put(`/api/v1/loans/${id}`).send(request())).status).toBe(422);
    expect((await borrower.post(`/api/v1/loans/${id}/cancel`)).status).toBe(422);
    // รายการเครื่อง: B ติดยืม
    const devices = (await borrower.get("/api/v1/loan-devices")).body.data;
    expect(devices.find((d: { id: number }) => d.id === nb2.id).on_loan).toMatchObject({ user: "ผู้ขอยืม", returning: false });
  });

  it("a return request stops overdue; IT must tick every lent accessory or note what is missing; then the device is free", async () => {
    const itStaff = await makeUser({ is_it_staff: true });
    const managerUser = await makeUser({ role: "admin" });
    const borrowerUser = await makeUser({ name: "ผู้ยืมเครื่อง" });
    const nb = await makeAsset({ name: "Notebook C", custodian_id: itStaff.id, is_loanable: true });
    const [borrower, manager] = [await as(borrowerUser, "th"), await as(managerUser, "th")];

    const id = (await borrower.post("/api/v1/loans").send(request())).body.data.id;
    await manager.post(`/api/v1/loans/${id}/hand-out`).send({ asset_id: nb.id, accessories: ["charger", "bag"] });

    // เลยกำหนดคืน → เกินกำหนด, ปฏิทินเดือนถัดไปยังเห็น (ยังไม่คืน)
    await exec("UPDATE equipment_loans SET start_on = ?, end_on = ?, end_time = '08:00' WHERE uuid = ?", [day(-3), day(-1), id]);
    expect((await borrower.get(`/api/v1/loans/${id}`)).body.data.is_overdue).toBe(true);
    expect((await borrower.get(`/api/v1/loans?from=${day(0)}&to=${day(5)}`)).body.data.map((l: { id: string }) => l.id)).toContain(id);
    expect(await notifyOverdueLoans()).toBe(1);

    // ผู้ยืมกดคืน → ไม่นับเกินกำหนด, แจ้งผู้จัดการ, แจ้งเตือนเกินกำหนดปิด, ตัวเลขแท็บ "รอยืนยันคืน"
    expect((await manager.post(`/api/v1/loans/${id}/request-return`)).status).toBe(403);
    const asked = await borrower.post(`/api/v1/loans/${id}/request-return`);
    expect(asked.body.data).toMatchObject({ status: "return_requested", is_overdue: false, can_request_return: false });
    expect(await notices(managerUser.id, "loan.return_requested")).toBe(1);
    expect(await notices(borrowerUser.id, "loan.overdue")).toBe(0);
    expect(await notifyOverdueLoans()).toBe(0);
    const badges = (await manager.get("/api/v1/menu-badges")).body.data;
    expect(badges["/loans/manage?status=returning"]).toBe(1);
    expect(badges["/loans/manage?status=overdue"]).toBe(0);
    expect((await manager.get("/api/v1/loans/manage?status=returning")).body.data.map((l: { id: string }) => l.id)).toEqual([id]);
    // ยังไม่ยืนยัน = เครื่องยังไม่ว่าง
    expect((await borrower.get("/api/v1/loan-devices")).body.data.find((d: { id: number }) => d.id === nb.id).on_loan).toMatchObject({ returning: true });

    // อุปกรณ์เสริมไม่ครบ + ไม่มีหมายเหตุ = 422, มีหมายเหตุ = ผ่าน
    expect((await manager.post(`/api/v1/loans/${id}/return`).send({ returned_accessories: ["charger"] })).status).toBe(422);
    expect((await manager.post(`/api/v1/loans/${id}/return`).field("accessories_checked", "1")).status).toBe(422);
    const back = await manager.post(`/api/v1/loans/${id}/return`).send({ returned_accessories: ["charger"], note: "กระเป๋ายังไม่คืน" });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: "returned", returned_accessories: ["charger"], return_note: "กระเป๋ายังไม่คืน" });
    expect(await notices(managerUser.id, "loan.return_requested")).toBe(0);
    expect((await borrower.get("/api/v1/loan-devices")).body.data.find((d: { id: number }) => d.id === nb.id).on_loan).toBeNull();
  });
});
