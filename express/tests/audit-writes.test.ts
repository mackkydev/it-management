import { describe, expect, it } from "vitest";
import { first, insert, scalar, select } from "../src/db.js";
import { as, guest, makeUser } from "./helpers.js";

/** audit_logs: เข้า-ออกระบบ + ใครสร้าง-ลบใบแจ้งงาน */
interface Log {
  actor_id: number | null;
  action: string;
  subject_id: string | null;
  before: Record<string, unknown> | string | null;
  after: Record<string, unknown> | string | null;
}
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const last = async (action: string) => {
  const row = await first<Log>("SELECT * FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1", [action]);
  return row && { ...row, before: parse(row.before), after: parse(row.after) };
};

describe("audit log: login and logout", () => {
  it("records who signed in and out; a wrong password records no sign-in; the token is never stored", async () => {
    const user = await makeUser({ email: "somying@example.com" });
    expect((await guest().post("/api/v1/auth/login").send({ login: "somying@example.com", password: "wrong", device_name: "t" })).status).toBe(422);
    expect(await last("auth.login")).toBeNull();

    const login = await guest().post("/api/v1/auth/login").send({ login: "somying@example.com", password: "password", device_name: "t" });
    expect(login.status).toBe(200);
    expect(await last("auth.login")).toMatchObject({ actor_id: user.id, subject_id: String(user.id), after: { method: "password" } });

    expect((await guest().post("/api/v1/auth/logout").set("Authorization", `Bearer ${login.body.token}`)).status).toBe(204);
    expect(await last("auth.logout")).toMatchObject({ actor_id: user.id, subject_id: String(user.id) });
    expect(JSON.stringify(await select("SELECT * FROM audit_logs"))).not.toContain(login.body.token);
  });

  it("records the browser the web app forwards and a plain IPv4 address; managers see the last sign-in source", async () => {
    const user = await makeUser({ email: "device@example.com" });
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const login = await guest()
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "::ffff:192.168.1.25")
      .set("X-Client-Agent", `${chrome} [pwa]`)
      .send({ login: "device@example.com", password: "password", device_name: "t" });
    expect(login.status).toBe(200);
    expect(await first("SELECT ip, user_agent FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1")).toEqual({ ip: "192.168.1.25", user_agent: `${chrome} [pwa]` });

    // ไม่ได้ส่ง X-Client-Agent = ใช้ User-Agent ของคำขอเอง (ตัดที่ 255 ตัวอักษร)
    await guest().post("/api/v1/auth/login").set("User-Agent", "x".repeat(300)).send({ login: "device@example.com", password: "password", device_name: "t" });
    expect(String(await scalar("SELECT user_agent FROM audit_logs WHERE action = 'auth.login' ORDER BY id DESC LIMIT 1"))).toHaveLength(255);
    // คำขอทั่วไปก็บันทึกเบราว์เซอร์ของผู้ทำ
    const admin = await makeUser({ role: "super_admin" });
    await (await as(admin)).post("/api/v1/auth/logout").set("X-Client-Agent", chrome);
    expect(await scalar("SELECT user_agent FROM audit_logs WHERE action = 'auth.logout' ORDER BY id DESC LIMIT 1")).toBe(chrome);

    // หน้าแก้ไขผู้ใช้: เข้าระบบล่าสุดจาก IP / เบราว์เซอร์ไหน (เฉพาะผู้จัดการผู้ใช้)
    const viewer = await as(await makeUser({ role: "super_admin" }));
    await guest().post("/api/v1/auth/login").set("X-Forwarded-For", "192.168.1.30").set("X-Client-Agent", chrome).send({ login: "device@example.com", password: "password", device_name: "t" });
    expect((await viewer.get(`/api/v1/users/${user.id}`)).body.meta.login_activity).toMatchObject({ last_login_ip: "192.168.1.30", last_login_agent: chrome });
    // รายการบันทึกการทำงานคืน user_agent + IP แบบอ่านง่าย
    const logs = (await viewer.get("/api/v1/audit-logs?per_page=100")).body.data as { action: string; ip: string | null; user_agent: string | null }[];
    expect(logs.find((l) => l.action === "auth.login" && l.ip === "192.168.1.25")).toMatchObject({ user_agent: `${chrome} [pwa]` });
  });

  it("super admins keep their own sign-in record without a duplicate", async () => {
    const root = await makeUser({ role: "super_admin", email: "root@example.com" });
    await guest().post("/api/v1/auth/login").send({ login: "root@example.com", password: "password", device_name: "t" });
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE actor_id = ? AND action = 'auth.super_admin_login'", [root.id])).toBe(1);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE actor_id = ? AND action = 'auth.login'", [root.id])).toBe(0);
  });
});

describe("audit log: who created and deleted tickets", () => {
  it("records the creator and the deleter with the ticket number; the type filter finds them", async () => {
    const root = await makeUser({ role: "super_admin" });
    const owner = await makeUser({ supervisor_id: root.id });
    const api = await as(owner);
    const branch = await insert("branches", { code: "AUD", name: "สาขาทดสอบ", sort_order: 1, is_active: true });
    const it_ = await makeUser({ is_it_staff: true });

    const created = await api.post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "ติดตั้งโปรแกรม", assignee_id: it_.id });
    expect(created.body.errors).toBeUndefined();
    expect(created.status).toBe(201);
    const { id, ticket_no } = created.body.data as { id: string; ticket_no: string };
    expect(await last("ticket.created")).toMatchObject({ actor_id: owner.id, subject_id: id, after: { ticket_no } });

    // ผู้แจ้งลบได้ก่อนมีการอนุมัติ
    const del = await api.delete(`/api/v1/tickets/${id}`);
    expect(del.status).toBe(204);
    expect(await last("ticket.deleted")).toMatchObject({ actor_id: owner.id, subject_id: id, before: { ticket_no } });

    const admin = await as(root);
    type Row = { action: string; subject_name: string | null };
    const found = (await admin.get("/api/v1/audit-logs?kind=deleted")).body.data as Row[];
    expect(found.find((r) => r.action === "ticket.deleted")?.subject_name).toBe(ticket_no);
    expect(((await admin.get("/api/v1/audit-logs?kind=created")).body.data as Row[]).map((r) => r.action)).toContain("ticket.created");
    expect(((await admin.get("/api/v1/audit-logs?kind=login")).body.data as Row[]).every((r) => r.action.startsWith("auth."))).toBe(true);
    expect((await admin.get("/api/v1/audit-logs?kind=updated")).status).toBe(422);
  });
});
