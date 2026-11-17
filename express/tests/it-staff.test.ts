import { describe, expect, it } from "vitest";
import { as, makeUser } from "./helpers.js";

describe("IT staff dropdowns", () => {
  it("every IT staff list = IT department / division first, then ticked as IT staff (also when ticked as a manager too)", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    await makeUser({ name: "แผนก IT ไม่ติ๊ก", department: "it" });
    await makeUser({ name: "ติ๊ก แต่แผนกบัญชี", is_it_staff: true, department: "บัญชี" });
    await makeUser({ name: "แผนก IT ติ๊ก", is_it_staff: true, department: " IT " });
    await makeUser({ name: "ฝ่าย IT ติ๊ก admin", is_it_staff: true, division: "ฝ่ายเทคโนโลยีสารสนเทศ", role: "admin" });
    await makeUser({ name: "ผจก.ฝ่าย ติ๊กเจ้าหน้าที่ด้วย", is_it_staff: true, is_it_head: true, department: "IT" });
    await makeUser({ name: "ผจก.แผนก ติ๊กเจ้าหน้าที่ด้วย", is_it_staff: true, is_it_manager: true, department: "IT" });
    await makeUser({ name: "ผจก.ฝ่าย อย่างเดียว", is_it_head: true, department: "IT" });
    await makeUser({ name: "ผจก.แผนก อย่างเดียว", is_it_manager: true, department: "IT" });
    await makeUser({ name: "ปิดใช้งาน", is_it_staff: true, department: "IT", is_active: false });
    const expected = ["แผนก IT ติ๊ก", "ฝ่าย IT ติ๊ก admin", "ผจก.ฝ่าย ติ๊กเจ้าหน้าที่ด้วย", "ผจก.แผนก ติ๊กเจ้าหน้าที่ด้วย"].sort();
    const names = (list: { name: string }[]) => list.map((s) => s.name).sort();

    expect(names((await root.get("/api/v1/tickets/form-options")).body.data.it_staff)).toEqual(expected);
    expect(names((await root.get("/api/v1/it-staff")).body.data)).toEqual(expected);
    expect(names((await root.get("/api/v1/repair-orders/form-options")).body.data.staff)).toEqual(expected);
  });

  it("saves the IT department manager tick on the user", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const target = await makeUser({ name: "คนใหม่" });
    const res = await root.patch(`/api/v1/users/${target.id}`).send({ is_it_manager: true, is_it_staff: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ is_it_manager: true, is_it_staff: true });
  });
});
