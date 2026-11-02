import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { as, makeUser } from "./helpers.js";

/** นโยบายของระบบที่ต้องยอมรับก่อนใช้งาน (app_settings.system_policy — services/system-policy.ts, routes/policy.ts) */

const SECTIONS = [
  { title: "การใช้งานบัญชี", body: "ห้ามให้ผู้อื่นใช้บัญชีของตนเอง" },
  { title: "ข้อมูลส่วนบุคคล", body: "ระบบเก็บประวัติการใช้งานเพื่อความปลอดภัย" },
];

describe("system policy acceptance", () => {
  it("blocks every user until they accept the current version, stamps the acceptance, and re-asks after a new version", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await makeUser({ name: "ผู้ใช้ทั่วไป" });
    const api = await as(staff);

    // ยังไม่ตั้ง = ไม่บังคับ
    expect((await api.get("/api/v1/auth/me")).body.data).toMatchObject({ policy_required: false, policy_accepted_at: null });
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // แก้ได้เฉพาะ settings.manage, เปิดโดยไม่มีหัวข้อไม่ได้
    expect((await (await as(await makeUser({ role: "admin" }))).put("/api/v1/policy").send({ enabled: true, sections: SECTIONS })).status).toBe(403);
    expect(Object.keys((await root.put("/api/v1/policy").send({ enabled: true, sections: [] })).body.errors)).toEqual(["sections"]);
    const saved = await root.put("/api/v1/policy").send({ enabled: true, sections: SECTIONS });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ enabled: true, version: 1, sections: SECTIONS });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.policy_updated'")).toBeTruthy();

    // ยังไม่ยอมรับ: ใช้งานอื่นไม่ได้ (403 policy_required) — อ่านนโยบาย / ข้อมูลตัวเอง ได้
    expect((await api.get("/api/v1/auth/me")).body.data.policy_required).toBe(true);
    const blocked = await api.get("/api/v1/tickets");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("policy_required");
    expect((await api.get("/api/v1/policy")).body).toMatchObject({ active: true, accepted_at: null, data: { version: 1, sections: SECTIONS } });

    // ยอมรับเวอร์ชันเก่า/ผิด = 422, ยอมรับเวอร์ชันปัจจุบัน = บันทึกวันเวลา + audit
    expect((await api.post("/api/v1/policy/accept").send({ version: 2 })).status).toBe(422);
    const accepted = await api.post("/api/v1/policy/accept").send({ version: 1, user_agent: "Test Browser" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.accepted_at).toBeTruthy();
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'policy.accepted' AND actor_id = ?", [staff.id])).toBeTruthy();
    // กดซ้ำ = คงวันเวลาเดิม, ไม่เพิ่มแถว
    expect((await api.post("/api/v1/policy/accept").send({ version: 1 })).body.data.accepted_at).toBe(accepted.body.data.accepted_at);
    expect(Number(await scalar("SELECT COUNT(*) FROM policy_acceptances WHERE user_id = ?", [staff.id]))).toBe(1);
    expect((await api.get("/api/v1/auth/me")).body.data).toMatchObject({ policy_required: false, policy_accepted_at: accepted.body.data.accepted_at });
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // ผู้ดูแลเห็นรายชื่อพร้อมวันที่ยอมรับ (ยอมรับแล้วขึ้นก่อน)
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    const list = (await root.get("/api/v1/policy/acceptances")).body;
    expect(list.version).toBe(1);
    expect(list.data.find((r: { user: { id: number } }) => r.user.id === staff.id)).toMatchObject({ user: { name: "ผู้ใช้ทั่วไป" }, accepted_at: accepted.body.data.accepted_at });
    expect(list.accepted).toBeGreaterThanOrEqual(2);

    // แก้เนื้อหาโดยไม่ให้ยอมรับใหม่ = เวอร์ชันเดิม (ยังใช้งานได้)
    expect((await root.put("/api/v1/policy").send({ enabled: true, sections: [...SECTIONS, { title: "เพิ่มเติม", body: "ข้อความ" }] })).body.data.version).toBe(1);
    expect((await api.get("/api/v1/tickets")).status).toBe(200);
    // ให้ทุกคนยอมรับใหม่ = เวอร์ชัน 2 → ต้องยอมรับอีกครั้ง
    expect((await root.put("/api/v1/policy").send({ enabled: true, reaccept: true, sections: SECTIONS })).body.data.version).toBe(2);
    expect((await api.get("/api/v1/tickets")).body.code).toBe("policy_required");
    expect((await api.post("/api/v1/policy/accept").send({ version: 1 })).status).toBe(422);
    await api.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // ปิดใช้งาน = ไม่บังคับ
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    await root.put("/api/v1/policy").send({ enabled: false, reaccept: true, sections: SECTIONS });
    expect((await (await as(await makeUser())).get("/api/v1/tickets")).status).toBe(200);
  });
});
