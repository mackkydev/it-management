import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { as, guest, makeUser, realImage } from "./helpers.js";

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

  it("options: enabled and display are set separately; only the login display exposes the policy publicly", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.put("/api/v1/policy/options").send({ enabled: true, display: "login" })).status).toBe(403);
    // เปิดโดยยังไม่มีหัวข้อไม่ได้
    expect(Object.keys((await root.put("/api/v1/policy/options").send({ enabled: true, display: "login" })).body.errors)).toEqual(["sections"]);
    expect((await root.put("/api/v1/policy/options").send({ enabled: false, display: "sideways" })).status).toBe(422);

    // บันทึกเนื้อหา (ไม่ส่ง enabled) = คงค่าเปิด-ปิดเดิม
    expect((await root.put("/api/v1/policy").send({ sections: SECTIONS })).body.data).toMatchObject({ enabled: false, display: "after_login" });
    expect((await guest().get("/api/v1/policy/public")).body.data).toBeNull();

    const on = await root.put("/api/v1/policy/options").send({ enabled: true, display: "after_login" });
    expect(on.body.data).toMatchObject({ enabled: true, display: "after_login", sections: SECTIONS });
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.policy_options'")).toBeTruthy();
    // แสดงหลัง login = ไม่เปิดเผยให้คนที่ยังไม่ login
    expect((await guest().get("/api/v1/policy/public")).body.data).toBeNull();

    await root.put("/api/v1/policy/options").send({ enabled: true, display: "login" });
    const pub = (await guest().get("/api/v1/policy/public")).body.data;
    expect(pub).toMatchObject({ version: 1, sections: SECTIONS, files: [] });
    // แก้เนื้อหาไม่ทับตัวเลือกการแสดง
    expect((await root.put("/api/v1/policy").send({ sections: SECTIONS })).body.data).toMatchObject({ enabled: true, display: "login" });
    // แสดงที่หน้า login ก็ยังต้องมีการยอมรับจริงก่อนใช้งาน
    expect((await (await as(await makeUser())).get("/api/v1/tickets")).body.code).toBe("policy_required");
  });

  it("attachments: managers upload and delete; readable while acceptance is required; public only on the login display", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser());
    await root.put("/api/v1/policy").send({ enabled: true, sections: SECTIONS });
    await root.post("/api/v1/policy/accept").send({ version: 1 });

    expect((await staff.post("/api/v1/policy/files").attach("files[]", Buffer.from("x"), "a.txt")).status).toBe(403);
    expect((await root.post("/api/v1/policy/files").attach("files[]", Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 255]), "virus.exe")).status).toBe(422);
    const up = await root.post("/api/v1/policy/files").attach("files[]", Buffer.from("ประกาศ"), "ประกาศ.txt");
    expect(up.status).toBe(201);
    const file = up.body.data[0];
    expect(file).toMatchObject({ name: "ประกาศ.txt", url: `/policy/files/${file.id}` });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.policy_file_added'")).toBeTruthy();

    // ยังไม่ยอมรับก็อ่านไฟล์ได้ และ GET /policy คืนรายการไฟล์
    expect((await staff.get("/api/v1/tickets")).body.code).toBe("policy_required");
    expect((await staff.get("/api/v1/policy")).body.data.files[0].id).toBe(file.id);
    const read = await staff.get(`/api/v1/policy/files/${file.id}`);
    expect(read.status).toBe(200);
    expect(read.text).toBe("ประกาศ");

    // คนที่ยังไม่ login: เปิดได้เฉพาะเมื่อแสดงที่หน้า login
    expect((await guest().get(`/api/v1/policy/public/files/${file.id}`)).status).toBe(404);
    expect((await guest().get(`/api/v1/policy/files/${file.id}`).set("Accept", "application/json")).status).toBe(401);
    await root.put("/api/v1/policy/options").send({ enabled: true, display: "login" });
    expect((await guest().get("/api/v1/policy/public")).body.data.files[0].url).toBe(`/policy/public/files/${file.id}`);
    expect((await guest().get(`/api/v1/policy/public/files/${file.id}`)).status).toBe(200);

    expect((await staff.delete(`/api/v1/policy/files/${file.id}`)).status).toBe(403);
    expect((await root.delete(`/api/v1/policy/files/${file.id}`)).status).toBe(204);
    expect((await root.get(`/api/v1/policy/files/${file.id}`)).status).toBe(404);
  });

  it("acceptance document: stamps the name, keeps the accepted version's text, and gets the signature once uploaded", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const owner = await makeUser({ name: "สมชาย ใจดี" });
    const api = await as(owner);
    const other = await as(await makeUser());
    await root.put("/api/v1/policy").send({ enabled: true, sections: SECTIONS });
    await api.post("/api/v1/policy/accept").send({ version: 1 });
    await other.post("/api/v1/policy/accept").send({ version: 1 });

    const doc = (await api.get(`/api/v1/policy/documents/${owner.id}`)).body.data;
    expect(doc).toMatchObject({ version: 1, sections: SECTIONS, name_stamp: "สมชาย ใจดี", signature_url: null, user: { id: owner.id, name: "สมชาย ใจดี" } });
    expect(doc.accepted_at).toBeTruthy();
    expect((await api.get(`/api/v1/policy/documents/${owner.id}/signature`)).status).toBe(404);

    // เอกสารของคนอื่น: เจ้าของ / users.view / settings.manage เท่านั้น
    expect((await other.get(`/api/v1/policy/documents/${owner.id}`)).status).toBe(403);
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    expect((await root.get(`/api/v1/policy/documents/${owner.id}`)).status).toBe(200);
    expect((await root.get("/api/v1/policy/documents/99999")).status).toBe(404);

    // เปลี่ยนชื่อภายหลัง + ออกฉบับใหม่ = เอกสารเดิมคงชื่อและเนื้อหาตอนยอมรับ
    await exec("UPDATE users SET name = 'ชื่อใหม่' WHERE id = ?", [owner.id]);
    await root.put("/api/v1/policy").send({ enabled: true, reaccept: true, sections: [{ title: "ฉบับใหม่", body: "ข้อความใหม่" }] });
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await root.get(`/api/v1/policy/documents/${owner.id}`)).body.data).toMatchObject({ version: 1, sections: SECTIONS, name_stamp: "สมชาย ใจดี" });
    await exec("UPDATE users SET name = 'สมชาย ใจดี' WHERE id = ?", [owner.id]);

    // ตารางผู้ใช้: ยอมรับฉบับเก่า = outdated, ยังไม่เคย = pending
    const list = async () => (await root.get("/api/v1/users?manage=1&per_page=100")).body.data as { id: number; policy_status: string; policy_accepted_at: string | null }[];
    expect((await list()).find((r) => r.id === owner.id)).toMatchObject({ policy_status: "outdated", policy_accepted_at: doc.accepted_at });

    // ยอมรับฉบับใหม่ก่อน แล้วค่อยอัปโหลดลายเซ็น = เติมให้ทุกฉบับที่ยังไม่มี
    await api.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await list()).find((r) => r.id === owner.id)?.policy_status).toBe("accepted");
    const fresh = await makeUser();
    expect((await list()).find((r) => r.id === fresh.id)).toMatchObject({ policy_status: "pending", policy_accepted_at: null });

    expect((await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig.png")).status).toBeLessThan(300);
    const signed = (await api.get(`/api/v1/policy/documents/${owner.id}`)).body.data;
    expect(signed).toMatchObject({ version: 2, sections: [{ title: "ฉบับใหม่" }], signature_url: `/policy/documents/${owner.id}/signature` });
    const image = await api.get(`/api/v1/policy/documents/${owner.id}/signature`);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(Number(await scalar("SELECT COUNT(*) FROM policy_acceptances WHERE user_id = ? AND signature_path IS NOT NULL AND signature_at IS NOT NULL", [owner.id]))).toBe(2);
    const paths = await scalar("SELECT signature_path FROM policy_acceptances WHERE user_id = ? AND version = 2", [owner.id]);

    // เปลี่ยนลายเซ็นทีหลัง = เอกสารที่เซ็นแล้วไม่เปลี่ยน; ยอมรับเมื่อมีลายเซ็นอยู่แล้ว = ประทับทันที
    await api.put("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig2.png");
    expect(await scalar("SELECT signature_path FROM policy_acceptances WHERE user_id = ? AND version = 2", [owner.id])).toBe(paths);
    await root.put("/api/v1/policy").send({ enabled: true, reaccept: true, sections: SECTIONS });
    await root.post("/api/v1/policy/accept").send({ version: 3 });
    await api.post("/api/v1/policy/accept").send({ version: 3 });
    expect((await api.get(`/api/v1/policy/documents/${owner.id}`)).body.data).toMatchObject({ version: 3, signature_url: `/policy/documents/${owner.id}/signature` });
  });
});
