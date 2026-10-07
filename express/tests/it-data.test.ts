import { describe, expect, it } from "vitest";
import { scalar } from "../src/db.js";
import { notifyExpiring } from "../src/jobs/notify-expiring.js";
import { decryptString } from "../src/lib/laravel-crypt.js";
import { sentMail } from "../src/services/mail.js";
import { EXPIRING_DIGEST, notifyUsers } from "../src/services/notifications.js";
import { putSetting } from "../src/services/settings.js";
import { as, day, makeBranch, makeContract, makeUser } from "./helpers.js";

/** ตรงกับ ItDataTest ของ Laravel */
describe("IT data", () => {
  it("credential categories: built-ins plus custom names typed in the form", async () => {
    const api = await as(await makeUser({ is_it_staff: true }));
    const created = await api.post("/api/v1/credentials").send({ title: "CCTV NVR", category: "  กล้องวงจรปิด  " });
    expect(created.status).toBe(201);
    expect(created.body.data.category).toBe("กล้องวงจรปิด");
    await api.post("/api/v1/credentials").send({ title: "Firewall", category: "network" });

    const cats = (await api.get("/api/v1/credentials/categories")).body.data;
    expect(cats.builtin).toContain("network");
    expect(cats.custom).toEqual(["กล้องวงจรปิด"]);
    const filtered = await api.get("/api/v1/credentials").query({ category: "กล้องวงจรปิด" });
    expect(filtered.body.data.map((c: { title: string }) => c.title)).toEqual(["CCTV NVR"]);

    expect((await api.post("/api/v1/credentials").send({ title: "x", category: "   " })).status).toBe(422);
    expect((await api.post("/api/v1/credentials").send({ title: "x", category: "a".repeat(31) })).status).toBe(422);
    // ลบบัญชีสุดท้ายของหมวด → หมวดหายจากรายการ
    await api.delete(`/api/v1/credentials/${created.body.data.id}`);
    expect((await api.get("/api/v1/credentials/categories")).body.data.custom).toEqual([]);
  });

  it("credentials are encrypted, hidden, and reveal is logged", async () => {
    const it_ = await makeUser({ is_it_staff: true });
    const api = await as(it_);

    const created = await api.post("/api/v1/credentials").send({ title: "Firewall", category: "network", username: "admin", password: "S3cret!pass" });
    expect(created.status).toBe(201);
    expect(created.body.data.has_password).toBe(true);
    expect(created.body.data).not.toHaveProperty("password");
    const id = created.body.data.id;

    // เก็บแบบเข้ารหัส (รูปแบบ Laravel) ในฐานข้อมูล
    const raw = String(await scalar("SELECT password FROM credentials WHERE id = ?", [id]));
    expect(raw).not.toContain("S3cret");
    expect(decryptString(raw)).toBe("S3cret!pass");

    const list = await api.get("/api/v1/credentials");
    expect(JSON.stringify(list.body)).not.toContain("S3cret");
    // ค่าเริ่มต้น: ยืนยันรหัสผ่านซ้ำก่อนเปิดดู (tests/secret-guard.test.ts)
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(428);
    await api.post("/api/v1/auth/reauth").send({ password: "password" });
    const reveal = await api.post(`/api/v1/credentials/${id}/reveal`);
    expect(reveal.body.data.password).toBe("S3cret!pass");
    expect((await api.get(`/api/v1/credentials/${id}/logs`)).body.data[0].action).toBe("reveal");

    // ไม่ส่ง password มา = คงเดิม
    expect((await api.patch(`/api/v1/credentials/${id}`).send({ title: "Firewall HQ" })).status).toBe(200);
    expect(decryptString(String(await scalar("SELECT password FROM credentials WHERE id = ?", [id])))).toBe("S3cret!pass");

    // ส่ง "" = ลบ
    const cleared = await api.patch(`/api/v1/credentials/${id}`).send({ password: "" });
    expect(cleared.body.data.has_password).toBe(false);

    const outsider = await as(await makeUser());
    expect((await outsider.get("/api/v1/credentials")).status).toBe(403);
    expect((await outsider.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(403);
  });

  it("contract status and expiry notification are sent once", async () => {
    const itStaff = await makeUser({ is_it_staff: true });
    await putSetting("notify_emails", ["it@example.com", "boss@example.com"], null);
    await putSetting("contract_notify_days", 30, null);

    await makeContract({ title: "MA Server", vendor_name: "ABC", start_date: day(-365), end_date: day(10) });
    await makeContract({ title: "Internet", vendor_name: "ISP", start_date: day(-365), end_date: day(60) });
    await makeContract({ title: "Custom", vendor_name: "X", start_date: day(0), end_date: day(80), notify_days_before: 90 });

    const api = await as(itStaff);
    const res = await api.get("/api/v1/contracts");
    expect(res.body.summary).toEqual({ active: 1, expiring: 2, expired: 0 });
    expect(res.body.default_notify_days).toBe(30);
    expect((await api.get("/api/v1/contracts?status=expiring")).body.data).toHaveLength(2);

    const first = await notifyExpiring();
    expect(first.sent).toBe(true);
    expect(first.items).toHaveLength(2);
    expect(sentMail.map((m) => m.to).sort()).toEqual(["boss@example.com", "it@example.com"]);
    expect(sentMail[0].subject).toBe("แจ้งเตือน: รายการใกล้หมดอายุ 2 รายการ");
    expect(Number(await scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = ?", [itStaff.id, EXPIRING_DIGEST]))).toBe(1);

    // รันซ้ำ: ไม่ส่งรายการเดิมอีก
    const again = await notifyExpiring();
    expect(again.items).toHaveLength(0);
  });

  it("settings and branches are admin only", async () => {
    const viewer = await as(await makeUser());
    expect((await viewer.get("/api/v1/settings")).status).toBe(403);
    expect((await viewer.post("/api/v1/branches").send({ code: "X", name: "X" })).status).toBe(403);
    expect((await viewer.get("/api/v1/branches")).status).toBe(200);

    const admin = await as(await makeUser({ role: "admin" }));
    const bad = await admin.put("/api/v1/settings").send({ notify_emails: ["A@x.com", "bad"], contract_notify_days: 45 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toHaveProperty(["notify_emails.1"]);

    const ok = await admin.put("/api/v1/settings").send({ notify_emails: ["A@x.com", "b@y.com"], contract_notify_days: 45 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ notify_emails: ["a@x.com", "b@y.com"], contract_notify_days: 45, ticket_other_types: ["งานออกแบบ"] });

    const created = await admin.post("/api/v1/branches").send({ code: "PKT", name: "ภูเก็ต" });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({ id: expect.any(Number), code: "PKT", name: "ภูเก็ต", work_group: null, sort_order: 0, is_active: true });
    await makeUser({ branch_id: created.body.data.id });
    expect((await admin.delete(`/api/v1/branches/${created.body.data.id}`)).status).toBe(422);
    const empty = await makeBranch({ code: "EMP" });
    expect((await admin.delete(`/api/v1/branches/${empty}`)).status).toBe(204);

    const manage = await admin.get("/api/v1/branches?include_inactive=1");
    expect(manage.body.data[0]).toMatchObject({ users_count: 1, tickets_count: 0 });
  });

  it("notifications endpoint", async () => {
    const u = await makeUser();
    await notifyUsers([u.id], EXPIRING_DIGEST, { kind: "expiring", count: 1, items: [] });
    const api = await as(u);

    const list = await api.get("/api/v1/notifications");
    expect(list.status).toBe(200);
    expect(list.body.unread_count).toBe(1);
    expect(list.body.data[0].data.kind).toBe("expiring");
    expect((await api.post(`/api/v1/notifications/${list.body.data[0].id}/read`)).status).toBe(204);
    expect((await api.get("/api/v1/notifications")).body.unread_count).toBe(0);
  });
});
