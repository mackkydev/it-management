import { describe, expect, it } from "vitest";
import { as, makeUser } from "./helpers.js";

describe("IT staff list (ticket assignee)", () => {
  it("lists everyone in the IT division / department plus users flagged as IT staff or IT head", async () => {
    const me = await as(await makeUser());
    await makeUser({ name: "ฝ่ายไทย", division: "ฝ่ายเทคโนโลยีสารสนเทศ" });
    await makeUser({ name: "ฝ่ายสั้น", division: " เทคโนโลยีสารสนเทศ " });
    await makeUser({ name: "แผนก IT", department: "it" });
    await makeUser({ name: "ฝ่าย IT", division: "ฝ่าย IT" });
    await makeUser({ name: "ติ๊ก จนท.", is_it_staff: true, division: "บัญชี" });
    await makeUser({ name: "ฝ่ายขาย", division: "ขาย" });
    await makeUser({ name: "IT ปิดใช้งาน", division: "เทคโนโลยีสารสนเทศ", is_active: false });

    const names = (await me.get("/api/v1/tickets/form-options")).body.data.it_staff.map((s: { name: string }) => s.name);
    expect(names.sort()).toEqual(["ฝ่ายไทย", "ฝ่ายสั้น", "แผนก IT", "ฝ่าย IT", "ติ๊ก จนท."].sort());
  });
});
