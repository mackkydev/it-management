import { beforeEach, describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import type { UserRow } from "../src/models/user.js";
import { as, day, fakeImage, fakePdf, makeAsset, makeBranch, makeUser, SIG } from "./helpers.js";

/** ตรงกับ ItTicketTest ของ Laravel */
let branch: number;
let chief: UserRow;
let staff: UserRow;
let it_: UserRow;
let itHead: UserRow;

const unread = async (u: UserRow) =>
  Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND read_at IS NULL", [u.id]));

beforeEach(async () => {
  branch = await makeBranch({ code: "KKN", name: "ขอนแก่น" });
  chief = await makeUser({ name: "Chief" });
  staff = await makeUser({ name: "Staff", supervisor_id: chief.id, branch_id: branch });
  it_ = await makeUser({ name: "IT", is_it_staff: true });
  itHead = await makeUser({ name: "IT Head", is_it_head: true });
});

async function submitRepair(): Promise<string> {
  const api = await as(staff);
  await makeAsset({ asset_tag: "IT-2026-000001" });
  const res = await api
    .post("/api/v1/tickets")
    .field("type", "repair")
    .field("branch_id", String(branch))
    .field("department", "ขาย")
    .field("division", "ขาย")
    .field("details", "จอไม่ติด")
    .field("due_date", day(3))
    .field("assignee_id", String(it_.id))
    .field("device_name", "Monitor")
    .field("asset_tag", "IT-2026-000001")
    .field("symptom", "เปิดไม่ติด มีเสียงแต่ไม่มีภาพ")
    .field("person_name_th", "ไม่ควรถูกเก็บ")
    .field("signature", SIG)
    .attach("photos[]", fakeImage(500), "a.jpg")
    .attach("photos[]", fakeImage(300, "png"), "รูป b.png")
    .attach("documents[]", fakePdf(800), "ใบเสนอราคา.pdf");

  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({
    status: "pending_supervisor",
    approver: { name: "Chief" },
    asset: { asset_tag: "IT-2026-000001" },
    person_name_th: null,
    branch: { id: branch, name: "ขอนแก่น" },
  });
  expect(res.body.data.attachments).toHaveLength(3);
  expect(res.body.data.attachments[1].name).toBe("รูป b.png");
  return res.body.data.id;
}

describe("IT tickets", () => {
  it("full workflow from request to close", async () => {
    const id = await submitRepair();
    const ticket = await first<{ approver_id: number; ticket_no: string }>("SELECT approver_id, ticket_no FROM it_tickets WHERE uuid = ?", [id]);
    expect(ticket!.approver_id).toBe(chief.id);
    expect(ticket!.ticket_no).toMatch(/^IT-\d{4}-00001$/);
    expect(await unread(chief)).toBe(1);

    // หัวหน้าเท่านั้นที่อนุมัติได้
    expect((await (await as(it_)).post(`/api/v1/tickets/${id}/approve`)).status).toBe(403);
    const chiefApi = await as(chief);
    expect((await chiefApi.get("/api/v1/tickets?scope=approvals")).body.counts.approvals).toBe(1);
    const approved = await chiefApi.post(`/api/v1/tickets/${id}/approve`).send({ comment: "ok" });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");
    expect(await unread(it_)).toBe(1);

    const itApi = await as(it_);
    expect((await itApi.post(`/api/v1/tickets/${id}/accept`)).body.data.status).toBe("in_progress");

    // งานซ่อมต้องระบุลักษณะงานซ่อม/การรับประกัน
    const missing = await itApi.post(`/api/v1/tickets/${id}/result`).field("result", "completed").field("completed_on", day(0)).field("signature", SIG);
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.errors)).toEqual(expect.arrayContaining(["repair_method", "warranty"]));

    const resulted = await itApi
      .post(`/api/v1/tickets/${id}/result`)
      .field("result", "completed")
      .field("completed_on", day(0))
      .field("repair_method", "external")
      .field("external_vendor", "ABC Service")
      .field("warranty", "out_of_warranty")
      .field("repair_details", "เปลี่ยนบอร์ดจ่ายไฟ")
      .field("parts[0][name]", "Power board")
      .field("parts[0][quantity]", "1")
      .field("parts[1][name]", "สายไฟ")
      .field("parts[1][quantity]", "2")
      .field("signature", SIG)
      .attach("photos[]", fakeImage(400), "after.jpg")
      .attach("parts[0][photo]", fakeImage(200), "p.jpg");
    expect(resulted.status).toBe(200);
    expect(resulted.body.data.status).toBe("pending_it_head");
    expect(resulted.body.data.parts).toHaveLength(2);
    expect(resulted.body.data.parts[0].photo_url).toMatch(/\/files\/part\/\d+$/);
    expect(resulted.body.data.parts[1]).toMatchObject({ name: "สายไฟ", quantity: 2, photo_url: null });
    expect(resulted.body.data.signatures.staff).toBe(`/tickets/${id}/files/staff-signature`);
    expect(await unread(itHead)).toBe(1);

    // หัวหน้า IT ส่งกลับ แล้วอนุมัติ
    const headApi = await as(itHead);
    expect((await headApi.post(`/api/v1/tickets/${id}/return`).send({ comment: "แนบรูปเพิ่ม" })).body.data.status).toBe("in_progress");
    const again = await itApi
      .post(`/api/v1/tickets/${id}/result`)
      .field("result", "completed").field("completed_on", day(0)).field("repair_method", "in_house").field("warranty", "in_warranty").field("signature", SIG);
    expect(again.status).toBe(200);
    expect(again.body.data.parts).toHaveLength(0);

    const closed = await headApi.post(`/api/v1/tickets/${id}/close`).send({ signature: SIG });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("completed");
    expect(closed.body.data.it_head.id).toBe(itHead.id);
    // submitted, approved, accepted, resulted, returned, resulted, closed
    expect(closed.body.data.events.map((e: { action: string }) => e.action)).toEqual([
      "submitted", "approved", "accepted", "resulted", "returned", "resulted", "closed",
    ]);
  });

  it("access requests require names and other requires text", async () => {
    const api = await as(staff);
    const access = await api.post("/api/v1/tickets").field("type", "grant_access").field("branch_id", String(branch)).field("details", "VPN").field("signature", SIG);
    expect(access.status).toBe(422);
    expect(Object.keys(access.body.errors)).toEqual(expect.arrayContaining(["person_name_th", "person_name_en"]));
    expect(access.body.errors.person_name_th[0]).toBe("กรุณากรอกชื่อ-สกุล (ไทย)");

    const other = await api.post("/api/v1/tickets").field("type", "other").field("branch_id", String(branch)).field("details", "ออกแบบโลโก้").field("signature", SIG);
    expect(other.body.errors).toHaveProperty("type_other");

    const ok = await api.post("/api/v1/tickets").field("type", "other").field("type_other", "งานออกแบบ").field("branch_id", String(branch)).field("details", "ออกแบบโลโก้").field("signature", SIG);
    expect(ok.status).toBe(201);
    expect(ok.body.data.type_other).toBe("งานออกแบบ");
  });

  it("upload limits and signature validation", async () => {
    const api = await as(staff);
    const base = (r: ReturnType<typeof api.post>) => r.field("type", "install").field("branch_id", String(branch)).field("details", "ติดตั้งโปรแกรม");

    let tooMany = base(api.post("/api/v1/tickets")).field("signature", SIG);
    for (let i = 1; i <= 5; i++) tooMany = tooMany.attach("photos[]", fakeImage(5), `${i}.jpg`);
    const r1 = await tooMany;
    expect(r1.status).toBe(422);
    expect(r1.body.errors).toHaveProperty("photos");

    const r2 = await base(api.post("/api/v1/tickets")).field("signature", SIG).attach("photos[]", fakeImage(1500), "big.jpg");
    expect(r2.status).toBe(422);
    expect(r2.body.errors["photos.0"][0]).toBe("รูปภาพต้องมีขนาดไม่เกิน 1024 KB");

    const r3 = await base(api.post("/api/v1/tickets")).field("signature", SIG).attach("photos[]", fakePdf(5), "fake.jpg");
    expect(r3.status).toBe(422);
    expect(r3.body.errors).toHaveProperty(["photos.0"]);

    const r4 = await base(api.post("/api/v1/tickets")).field("signature", "data:image/png;base64,bm90LWEtcG5n");
    expect(r4.status).toBe(422);
    expect(r4.body.errors.signature[0]).toBe("ลายเซ็นไม่ถูกต้อง กรุณาเซ็นใหม่");
    expect(Number(await scalar("SELECT COUNT(*) FROM it_tickets"))).toBe(0); // rollback
  });

  it("visibility and files", async () => {
    const id = await submitRepair();
    const outsider = await as(await makeUser({ name: "Outsider" }));
    expect((await outsider.get(`/api/v1/tickets/${id}`)).status).toBe(403);
    expect((await outsider.get(`/api/v1/tickets/${id}/files/requester-signature`)).status).toBe(403);

    const itApi = await as(it_);
    const detail = await itApi.get(`/api/v1/tickets/${id}`);
    expect(detail.status).toBe(200);
    const attachment = await itApi.get(`/api/v1${detail.body.data.attachments[0].url}`);
    expect(attachment.status).toBe(200);
    expect(attachment.headers["content-type"]).toBe("image/jpeg");
    const sig = await itApi.get(`/api/v1/tickets/${id}/files/requester-signature`);
    expect(sig.status).toBe(200);
    expect(sig.headers["content-type"]).toBe("image/png");
    expect((await itApi.get(`/api/v1/tickets/${id}/files/attachment/abc`)).status).toBe(404);

    const staffApi = await as(staff);
    expect((await staffApi.get("/api/v1/tickets?scope=it")).status).toBe(403);
    expect((await staffApi.get("/api/v1/tickets?scope=mine")).body.meta.total).toBe(1);
  });

  it("requester without supervisor is approved by admin", async () => {
    const lonely = await makeUser({ name: "No boss" });
    const admin = await makeUser({ role: "admin" });
    const id = (await (await as(lonely)).post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "x", signature: SIG })).body.data.id;
    expect(await unread(admin)).toBe(1);

    const api = await as(admin);
    expect((await api.post(`/api/v1/tickets/${id}/reject`).send({})).status).toBe(422);
    const rejected = await api.post(`/api/v1/tickets/${id}/reject`).send({ comment: "ข้อมูลไม่ครบ" });
    expect(rejected.body.data.status).toBe("rejected");
    expect(await unread(lonely)).toBe(1);
  });

  it("form options and it-staff", async () => {
    const api = await as(staff);
    const opts = await api.get("/api/v1/tickets/form-options");
    expect(opts.body.data.branches).toEqual([{ id: branch, code: "KKN", name: "ขอนแก่น" }]);
    expect(opts.body.data.it_staff.map((u: { name: string }) => u.name)).toEqual(["IT", "IT Head"]);
    expect(opts.body.data.other_types).toEqual(["งานออกแบบ"]);
    expect((await api.get("/api/v1/it-staff")).body.data).toContainEqual({ id: itHead.id, name: "IT Head", is_it_head: true });
  });
});
