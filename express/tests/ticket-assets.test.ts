import { describe, expect, it } from "vitest";
import { first } from "../src/db.js";
import { as, makeAsset, makeBranch, makeUser, SIG } from "./helpers.js";

/** ใบแจ้งงาน: เลือกเครื่องที่ส่งซ่อม / ติดตั้ง จากสินทรัพย์ของตัวเอง */
describe("ticket form — my assets", () => {
  it("lists only the requester's own assets (custodian or register user name), not disposed / lost", async () => {
    const me = await makeUser({ name: "สมชาย ใจดี" });
    const other = await makeUser();
    await makeAsset({ asset_tag: "PC-MINE", name: "Desktop", custodian_id: me.id });
    await makeAsset({ asset_tag: "NB-REG", name: "Laptop", category: "COMPUTER", user_name: " สมชาย ใจดี " });
    await makeAsset({ asset_tag: "PC-OTHER", custodian_id: other.id });
    await makeAsset({ asset_tag: "PC-OLD", custodian_id: me.id, status: "disposed" });
    await makeAsset({ asset_tag: "PC-LOST", custodian_id: me.id, status: "lost" });

    const opts = (await (await as(me)).get("/api/v1/tickets/form-options")).body.data;
    expect(opts.my_assets.map((a: { asset_tag: string }) => a.asset_tag)).toEqual(["NB-REG", "PC-MINE"]);
    expect(opts.my_assets[1]).toMatchObject({ asset_tag: "PC-MINE", name: "Desktop" });
  });

  it("install tickets keep the chosen machine (linked to the asset); symptom stays repair-only", async () => {
    const me = await makeUser();
    const staff = await makeUser({ is_it_staff: true });
    const branch = await makeBranch();
    const pc = await makeAsset({ asset_tag: "PC-9", name: "Desktop", custodian_id: me.id });

    const res = await (await as(me))
      .post("/api/v1/tickets")
      .field("type", "install")
      .field("branch_id", String(branch))
      .field("assignee_id", String(staff.id))
      .field("details", "ติดตั้งโปรแกรมบัญชี")
      .field("device_name", "Desktop")
      .field("asset_tag", "PC-9")
      .field("symptom", "ไม่ควรถูกเก็บ")
      .field("signature", SIG);
    expect(res.status).toBe(201);
    expect(await first("SELECT device_name, asset_tag, asset_id, symptom FROM it_tickets WHERE uuid = ?", [res.body.data.id])).toEqual({
      device_name: "Desktop", asset_tag: "PC-9", asset_id: pc.id, symptom: null,
    });
  });
});
