import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { as, guest, makeUser, realImage } from "./helpers.js";

/** นโยบายของระบบที่ต้องยอมรับก่อนใช้งาน (services/system-policy.ts, routes/policy.ts, routes/policy-versions.ts) */

const SECTIONS = [
  { title: "การใช้งานบัญชี", body: "ห้ามให้ผู้อื่นใช้บัญชีของตนเอง" },
  { title: "ข้อมูลส่วนบุคคล", body: "ระบบเก็บประวัติการใช้งานเพื่อความปลอดภัย" },
];
type Api = Awaited<ReturnType<typeof as>>;

/** เพิ่มฉบับใหม่ + ตั้งเป็นฉบับที่แสดง */
async function publish(root: Api, sections = SECTIONS, title = "นโยบายทดสอบ"): Promise<number> {
  const version = (await root.post("/api/v1/policy/versions").send({ title, sections })).body.data.version as number;
  expect((await root.put(`/api/v1/policy/versions/${version}/default`)).status).toBe(200);
  return version;
}
const enable = (root: Api, display = "after_login") => root.put("/api/v1/policy/options").send({ enabled: true, display });

describe("system policy acceptance", () => {
  it("blocks every user until they accept the shown version, stamps the acceptance, and re-asks after a new default", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await makeUser({ name: "ผู้ใช้ทั่วไป" });
    const api = await as(staff);

    // ยังไม่ตั้ง = ไม่บังคับ
    expect((await api.get("/api/v1/auth/me")).body.data).toMatchObject({ policy_required: false, policy_accepted_at: null });
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // จัดการได้เฉพาะ policy.manage, เปิดโดยยังไม่มีฉบับที่แสดงไม่ได้
    expect((await (await as(await makeUser({ role: "admin" }))).post("/api/v1/policy/versions").send({ title: "x", sections: SECTIONS })).status).toBe(403);
    expect(Object.keys((await enable(root)).body.errors)).toEqual(["sections"]);
    expect(await publish(root)).toBe(1);
    expect((await enable(root)).body.data).toMatchObject({ enabled: true, version: 1, sections: SECTIONS });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'policy.default_changed'")).toBeTruthy();

    // ยังไม่ยอมรับ: ใช้งานอื่นไม่ได้ (403 policy_required) — อ่านนโยบาย / ข้อมูลตัวเอง ได้
    expect((await api.get("/api/v1/auth/me")).body.data.policy_required).toBe(true);
    const blocked = await api.get("/api/v1/tickets");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("policy_required");
    expect((await api.get("/api/v1/policy")).body).toMatchObject({ active: true, accepted_at: null, data: { version: 1, title: "นโยบายทดสอบ", sections: SECTIONS } });

    // ยอมรับฉบับเก่า/ผิด = 422, ยอมรับฉบับที่แสดงอยู่ = บันทึกวันเวลา + audit
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

    // ตั้งฉบับใหม่ = ต้องยอมรับอีกครั้ง
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    expect(await publish(root)).toBe(2);
    expect((await api.get("/api/v1/tickets")).body.code).toBe("policy_required");
    expect((await api.post("/api/v1/policy/accept").send({ version: 1 })).status).toBe(422);
    await api.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // ตั้งกลับฉบับที่เคยยอมรับแล้ว = ไม่ต้องยอมรับซ้ำ
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    await root.put("/api/v1/policy/versions/1/default");
    expect((await api.get("/api/v1/tickets")).status).toBe(200);

    // ปิดใช้งาน = ไม่บังคับ
    await root.put("/api/v1/policy/options").send({ enabled: false, display: "after_login" });
    expect((await (await as(await makeUser())).get("/api/v1/tickets")).status).toBe(200);
  });

  it("options: enabled and display are set separately; only the login display exposes the policy publicly", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await enable(admin, "login")).status).toBe(403);
    // เปิดโดยยังไม่มีหัวข้อไม่ได้
    expect(Object.keys((await enable(root, "login")).body.errors)).toEqual(["sections"]);
    expect((await root.put("/api/v1/policy/options").send({ enabled: false, display: "sideways" })).status).toBe(422);

    // ตั้งฉบับที่แสดง = คงค่าเปิด-ปิดเดิม
    await publish(root);
    expect((await root.get("/api/v1/policy")).body.data).toMatchObject({ enabled: false, display: "after_login" });
    expect((await guest().get("/api/v1/policy/public")).body.data).toBeNull();

    const on = await enable(root);
    expect(on.body.data).toMatchObject({ enabled: true, display: "after_login", sections: SECTIONS });
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.policy_options'")).toBeTruthy();
    // แสดงหลัง login = ไม่เปิดเผยให้คนที่ยังไม่ login
    expect((await guest().get("/api/v1/policy/public")).body.data).toBeNull();

    await enable(root, "login");
    expect((await guest().get("/api/v1/policy/public")).body.data).toMatchObject({ version: 1, sections: SECTIONS, files: [] });
    // เปลี่ยนฉบับไม่ทับตัวเลือกการแสดง
    await publish(root);
    expect((await root.get("/api/v1/policy")).body.data).toMatchObject({ enabled: true, display: "login", version: 2 });
    // แสดงที่หน้า login ก็ยังต้องมีการยอมรับจริงก่อนใช้งาน
    expect((await (await as(await makeUser())).get("/api/v1/tickets")).body.code).toBe("policy_required");
  });

  it("versions: draft, edit, duplicate with its own files, default and delete rules", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser());

    const created = await root.post("/api/v1/policy/versions").send({ title: "นโยบาย IT", sections: SECTIONS });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ version: 1, title: "นโยบาย IT", is_default: false, published_at: null, accepted: 0, locked: false, files: [] });
    expect((await staff.get("/api/v1/policy/versions")).status).toBe(403);
    expect(Object.keys((await root.post("/api/v1/policy/versions").send({ title: "", sections: [] })).body.errors)).toEqual(["title"]);

    // ร่างไม่มีหัวข้อตั้งเป็นฉบับที่แสดงไม่ได้
    const empty = await root.post("/api/v1/policy/versions").send({ title: "ร่างว่าง", sections: [] });
    expect((await root.put(`/api/v1/policy/versions/${empty.body.data.version}/default`)).status).toBe(422);
    expect((await root.delete(`/api/v1/policy/versions/${empty.body.data.version}`)).status).toBe(204);

    // แก้ร่าง + แนบไฟล์
    expect((await root.put("/api/v1/policy/versions/1").send({ title: "นโยบาย IT 2569", sections: [SECTIONS[0]] })).body.data).toMatchObject({ title: "นโยบาย IT 2569", sections: [SECTIONS[0]] });
    expect((await staff.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from("x"), "a.txt")).status).toBe(403);
    expect((await root.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 255]), "virus.exe")).status).toBe(422);
    const up = await root.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from("ฉบับหนึ่ง"), "แนบ.txt");
    expect(up.status).toBe(201);
    const file = up.body.data.files[0];
    expect(file).toMatchObject({ name: "แนบ.txt", url: `/policy/files/${file.id}` });

    // ร่าง: ผู้ใช้ทั่วไปเปิดไฟล์ไม่ได้
    expect((await staff.get(`/api/v1/policy/files/${file.id}`)).status).toBe(404);
    expect((await root.get(`/api/v1/policy/files/${file.id}`)).status).toBe(200);

    // คัดลอก = ฉบับใหม่ มีไฟล์ของตัวเอง ลบแล้วไม่กระทบฉบับเดิม
    const copy = await root.post("/api/v1/policy/versions/1/duplicate");
    expect(copy.status).toBe(201);
    expect(copy.body.data).toMatchObject({ version: 2, title: "นโยบาย IT 2569", sections: [SECTIONS[0]], is_default: false, published_at: null });
    const copied = copy.body.data.files[0];
    expect(copied.name).toBe("แนบ.txt");
    expect(copied.id).not.toBe(file.id);
    expect((await root.delete(`/api/v1/policy/versions/2/files/${copied.id}`)).status).toBe(204);
    expect((await root.get(`/api/v1/policy/files/${file.id}`)).text).toBe("ฉบับหนึ่ง");
    expect((await root.delete(`/api/v1/policy/versions/1/files/${copied.id}`)).status).toBe(404);

    // ฉบับที่แสดงอยู่: แก้แล้วผู้ใช้เห็นทันที, ลบไม่ได้
    await root.put("/api/v1/policy/versions/1/default");
    await root.put("/api/v1/policy/versions/1").send({ title: "นโยบาย IT 2569", sections: SECTIONS });
    expect((await root.get("/api/v1/policy")).body.data).toMatchObject({ version: 1, sections: SECTIONS });
    expect(Object.keys((await root.put("/api/v1/policy/versions/1").send({ title: "x", sections: [] })).body.errors)).toEqual(["sections"]);
    expect((await root.delete("/api/v1/policy/versions/1")).status).toBe(422);
    expect((await staff.get(`/api/v1/policy/files/${file.id}`)).status).toBe(200);

    // มีผู้ยอมรับแล้ว: แก้ได้เฉพาะชื่อ, แตะไฟล์ไม่ได้, ลบไม่ได้แม้ไม่ได้แสดงอยู่
    await enable(root);
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    await staff.post("/api/v1/policy/accept").send({ version: 1 });
    expect((await root.put("/api/v1/policy/versions/1").send({ title: "ชื่อใหม่", sections: [SECTIONS[0]] })).status).toBe(422);
    expect((await root.put("/api/v1/policy/versions/1").send({ title: "ชื่อใหม่", sections: SECTIONS })).body.data).toMatchObject({ title: "ชื่อใหม่", locked: true, accepted: 2 });
    expect((await root.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from("x"), "a.txt")).status).toBe(422);
    expect((await root.delete(`/api/v1/policy/versions/1/files/${file.id}`)).status).toBe(422);
    await root.put("/api/v1/policy/versions/2").send({ title: "ฉบับสอง", sections: SECTIONS });
    await root.put("/api/v1/policy/versions/2/default");
    // ผู้ตั้งฉบับใหม่ก็ต้องยอมรับก่อนใช้งานต่อเหมือนทุกคน
    expect((await root.get("/api/v1/policy/versions")).body.code).toBe("policy_required");
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await root.delete("/api/v1/policy/versions/1")).status).toBe(422);

    // ลบเลขสูงสุดแล้ว เลขไม่ถูกใช้ซ้ำกับฉบับที่มีผู้ยอมรับ
    const list = (await root.get("/api/v1/policy/versions")).body;
    expect(list.data.map((v: { version: number; is_default: boolean }) => [v.version, v.is_default])).toEqual([[2, true], [1, false]]);
    expect((await root.post("/api/v1/policy/versions").send({ title: "ฉบับสาม", sections: [] })).body.data.version).toBe(3);
  });

  it("previous version: the published one right before the shown one, drafts are skipped", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser());
    await enable(root).catch(() => null);
    expect((await root.get("/api/v1/policy/previous")).body.data).toBeNull();

    await publish(root, SECTIONS, "ฉบับแรก");
    await enable(root);
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    await staff.post("/api/v1/policy/accept").send({ version: 1 });
    expect((await staff.get("/api/v1/policy/previous")).body.data).toBeNull();

    // ร่างที่ไม่เคยประกาศใช้ไม่นับ
    await root.post("/api/v1/policy/versions").send({ title: "ร่าง", sections: SECTIONS });
    const file = (await root.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from("x"), "a.txt")).status;
    expect(file).toBe(422); // มีผู้ยอมรับแล้ว แนบเพิ่มไม่ได้
    const latest = await publish(root, [SECTIONS[1]], "ฉบับล่าสุด");
    expect(latest).toBe(3);
    await root.post("/api/v1/policy/accept").send({ version: 3 });
    await staff.post("/api/v1/policy/accept").send({ version: 3 });
    expect((await staff.get("/api/v1/policy/previous")).body.data).toMatchObject({ version: 1, title: "ฉบับแรก", sections: SECTIONS, files: [] });

    // ปิดใช้งาน = ไม่มีให้ดู
    await root.put("/api/v1/policy/options").send({ enabled: false, display: "after_login" });
    expect((await staff.get("/api/v1/policy/previous")).body.data).toBeNull();
  });

  it("acceptance list per version: names, pending users, former staff kept as evidence", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const owner = await makeUser({ name: "คนยอมรับ", department: "บัญชี" });
    const pending = await makeUser({ name: "คนยังไม่ยอมรับ" });
    const left = await makeUser({ name: "คนลาออก" });
    await publish(root);
    await enable(root);
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    await (await as(owner)).post("/api/v1/policy/accept").send({ version: 1 });
    await (await as(left)).post("/api/v1/policy/accept").send({ version: 1 });
    await exec("UPDATE users SET is_active = false WHERE id = ?", [left.id]);

    expect((await (await as(owner)).get("/api/v1/policy/versions/1/acceptances")).status).toBe(403);
    const body = (await root.get("/api/v1/policy/versions/1/acceptances")).body;
    type Row = { user: { id: number; name: string; department: string | null }; accepted_at: string | null; name_stamp: string | null };
    const row = (id: number) => (body.data as Row[]).find((r) => r.user.id === id);
    expect(body).toMatchObject({ version: 1, title: "นโยบายทดสอบ", accepted: 3 });
    expect(row(owner.id)).toMatchObject({ user: { name: "คนยอมรับ", department: "บัญชี" }, name_stamp: "คนยอมรับ" });
    expect(row(owner.id)?.accepted_at).toBeTruthy();
    expect(row(pending.id)?.accepted_at).toBeNull();
    expect(row(left.id)?.accepted_at).toBeTruthy();
    // ฉบับใหม่นับแยก
    await publish(root);
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await root.get("/api/v1/policy/versions/2/acceptances")).body.accepted).toBe(1);
    expect((await root.get("/api/v1/policy/versions/99/acceptances")).status).toBe(404);
  });

  it("attachments: readable while acceptance is required; public only for the shown version on the login display", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser());
    await root.post("/api/v1/policy/versions").send({ title: "มีไฟล์", sections: SECTIONS });
    const file = (await root.post("/api/v1/policy/versions/1/files").attach("files[]", Buffer.from("ประกาศ"), "ประกาศ.txt")).body.data.files[0];
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'policy.file_added'")).toBeTruthy();
    await root.put("/api/v1/policy/versions/1/default");
    await enable(root);
    await root.post("/api/v1/policy/accept").send({ version: 1 });

    // ยังไม่ยอมรับก็อ่านไฟล์ได้ และ GET /policy คืนรายการไฟล์
    expect((await staff.get("/api/v1/tickets")).body.code).toBe("policy_required");
    expect((await staff.get("/api/v1/policy")).body.data.files[0].id).toBe(file.id);
    const read = await staff.get(`/api/v1/policy/files/${file.id}`);
    expect(read.status).toBe(200);
    expect(read.text).toBe("ประกาศ");

    // คนที่ยังไม่ login: เปิดได้เฉพาะเมื่อแสดงที่หน้า login
    expect((await guest().get(`/api/v1/policy/public/files/${file.id}`)).status).toBe(404);
    expect((await guest().get(`/api/v1/policy/files/${file.id}`).set("Accept", "application/json")).status).toBe(401);
    await enable(root, "login");
    expect((await guest().get("/api/v1/policy/public")).body.data.files[0].url).toBe(`/policy/public/files/${file.id}`);
    expect((await guest().get(`/api/v1/policy/public/files/${file.id}`)).status).toBe(200);

    // เปลี่ยนฉบับที่แสดง = ไฟล์ของฉบับเดิมไม่เปิดสู่สาธารณะอีก แต่ผู้ใช้ที่ login ยังเปิดได้
    await publish(root);
    expect((await guest().get(`/api/v1/policy/public/files/${file.id}`)).status).toBe(404);
    expect((await guest().get("/api/v1/policy/public")).body.data.files).toEqual([]);
    expect((await staff.get(`/api/v1/policy/files/${file.id}`)).status).toBe(200);
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    await staff.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await staff.delete(`/api/v1/policy/versions/1/files/${file.id}`)).status).toBe(403);
    // มีผู้ยอมรับแล้ว = เอาไฟล์ออกไม่ได้
    expect((await root.delete(`/api/v1/policy/versions/1/files/${file.id}`)).status).toBe(422);
    const draft = (await root.post("/api/v1/policy/versions").send({ title: "ร่าง", sections: [] })).body.data.version as number;
    const draftFile = (await root.post(`/api/v1/policy/versions/${draft}/files`).attach("files[]", Buffer.from("ร่าง"), "ร่าง.txt")).body.data.files[0];
    expect((await root.delete(`/api/v1/policy/versions/${draft}/files/${draftFile.id}`)).status).toBe(204);
    expect((await root.get(`/api/v1/policy/files/${draftFile.id}`)).status).toBe(404);
  });

  it("acceptance document: stamps the name, keeps the accepted version's text, opens by version, and gets the signature once uploaded", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const owner = await makeUser({ name: "สมชาย ใจดี" });
    const api = await as(owner);
    const other = await as(await makeUser());
    await publish(root);
    await enable(root);
    await api.post("/api/v1/policy/accept").send({ version: 1 });
    await other.post("/api/v1/policy/accept").send({ version: 1 });

    const doc = (await api.get(`/api/v1/policy/documents/${owner.id}`)).body.data;
    expect(doc).toMatchObject({ version: 1, sections: SECTIONS, name_stamp: "สมชาย ใจดี", signature_url: null, user: { id: owner.id, name: "สมชาย ใจดี" } });
    expect(doc.accepted_at).toBeTruthy();
    expect((await api.get(`/api/v1/policy/documents/${owner.id}/signature`)).status).toBe(404);

    // เอกสารของคนอื่น: เจ้าของ / users.view / policy.manage เท่านั้น
    expect((await other.get(`/api/v1/policy/documents/${owner.id}`)).status).toBe(403);
    await root.post("/api/v1/policy/accept").send({ version: 1 });
    expect((await root.get(`/api/v1/policy/documents/${owner.id}`)).status).toBe(200);
    expect((await root.get("/api/v1/policy/documents/99999")).status).toBe(404);

    // เปลี่ยนชื่อภายหลัง + ออกฉบับใหม่ = เอกสารเดิมคงชื่อและเนื้อหาตอนยอมรับ
    await exec("UPDATE users SET name = 'ชื่อใหม่' WHERE id = ?", [owner.id]);
    const v2 = [{ title: "ฉบับใหม่", body: "ข้อความใหม่" }];
    await publish(root, v2);
    await root.post("/api/v1/policy/accept").send({ version: 2 });
    expect((await root.get(`/api/v1/policy/documents/${owner.id}`)).body.data).toMatchObject({ version: 1, sections: SECTIONS, name_stamp: "สมชาย ใจดี" });
    await exec("UPDATE users SET name = 'สมชาย ใจดี' WHERE id = ?", [owner.id]);
    // ระบุฉบับที่ยังไม่ยอมรับ = เนื้อหาฉบับนั้น แต่ยังไม่มีตรายอมรับ
    expect((await root.get(`/api/v1/policy/documents/${owner.id}?version=2`)).body.data).toMatchObject({ version: 2, sections: v2, accepted_at: null, name_stamp: null });

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
    expect((await root.get(`/api/v1/policy/documents/${owner.id}?version=1`)).body.data).toMatchObject({ version: 1, signature_url: `/policy/documents/${owner.id}/signature?version=1` });
    expect((await root.get(`/api/v1/policy/documents/${owner.id}/signature?version=1`)).status).toBe(200);
    expect(Number(await scalar("SELECT COUNT(*) FROM policy_acceptances WHERE user_id = ? AND signature_path IS NOT NULL AND signature_at IS NOT NULL", [owner.id]))).toBe(2);
    const paths = await scalar("SELECT signature_path FROM policy_acceptances WHERE user_id = ? AND version = 2", [owner.id]);

    // เปลี่ยนลายเซ็นทีหลัง = เอกสารที่เซ็นแล้วไม่เปลี่ยน; ยอมรับเมื่อมีลายเซ็นอยู่แล้ว = ประทับทันที
    await api.put("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig2.png");
    expect(await scalar("SELECT signature_path FROM policy_acceptances WHERE user_id = ? AND version = 2", [owner.id])).toBe(paths);
    await publish(root);
    await root.post("/api/v1/policy/accept").send({ version: 3 });
    await api.post("/api/v1/policy/accept").send({ version: 3 });
    expect((await api.get(`/api/v1/policy/documents/${owner.id}`)).body.data).toMatchObject({ version: 3, signature_url: `/policy/documents/${owner.id}/signature` });
  });
});

describe("other policies", () => {
  it("managers keep a list with documents; users see active ones and open their files", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser());
    const form = { title: "นโยบายความปลอดภัย", description: "สำหรับพนักงาน", sort_order: "1", is_active: "1" };
    const send = <T extends { field: (k: string, v: string) => T }>(req: T, fields: Record<string, string>) => {
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    };

    expect((await send(staff.post("/api/v1/policy/others"), form)).status).toBe(403);
    expect((await root.post("/api/v1/policy/others").send({ title: "" })).status).toBe(422);
    expect((await send(root.post("/api/v1/policy/others"), form).attach("files[]", Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 255]), "virus.exe")).status).toBe(422);

    const created = await send(root.post("/api/v1/policy/others"), form).attach("files[]", Buffer.from("เอกสาร"), "เอกสาร.txt");
    expect(created.status).toBe(201);
    const { id, files } = created.body.data as { id: number; files: { id: number; name: string; url: string }[] };
    expect(files[0]).toMatchObject({ name: "เอกสาร.txt", url: `/policy/others/${id}/files/${files[0].id}` });

    const seen = await staff.get("/api/v1/policy/others");
    expect(seen.body.data).toMatchObject([{ id, title: "นโยบายความปลอดภัย", description: "สำหรับพนักงาน" }]);
    expect((await staff.get(`/api/v1${files[0].url}`)).text).toBe("เอกสาร");
    expect((await guest().get(`/api/v1${files[0].url}`).set("Accept", "application/json")).status).toBe(401);
    expect((await staff.get("/api/v1/policy/others?all=1")).status).toBe(403);

    // ซ่อน = ผู้ใช้ไม่เห็นและเปิดไฟล์ไม่ได้ ผู้จัดการยังเห็น
    const hidden = await send(root.put(`/api/v1/policy/others/${id}`), { ...form, is_active: "0" });
    expect(hidden.body.data.files).toHaveLength(1);
    expect((await staff.get("/api/v1/policy/others")).body.data).toEqual([]);
    expect((await staff.get(`/api/v1${files[0].url}`)).status).toBe(404);
    expect((await root.get(`/api/v1${files[0].url}`)).status).toBe(200);
    expect((await root.get("/api/v1/policy/others?all=1")).body.data).toHaveLength(1);

    // เอาไฟล์ออก + ลบรายการ
    const removed = await send(root.put(`/api/v1/policy/others/${id}`), { ...form, "remove_file_ids[]": String(files[0].id) });
    expect(removed.body.data.files).toEqual([]);
    expect((await root.get(`/api/v1${files[0].url}`)).status).toBe(404);
    expect((await root.delete(`/api/v1/policy/others/${id}`)).status).toBe(204);
    expect((await root.delete(`/api/v1/policy/others/${id}`)).status).toBe(404);
  });
});
