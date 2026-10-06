import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { exec, first, insert, scalar, select } from "../src/db.js";
import { encryptString } from "../src/lib/laravel-crypt.js";
import { nowDb, toDbDateTime } from "../src/lib/time.js";
import { createToken } from "../src/lib/tokens.js";
import type { UserRow } from "../src/models/user.js";
import { provisionUser } from "../src/services/api-auth.js";
import type { ApiConnectionRow } from "../src/models/api-connection.js";
import { readStoredBuffer } from "../src/services/ticket-files.js";
import { setUpstreamTestHooks, type UpstreamHttpRequest } from "../src/services/upstream-http.js";
import { as, fakeImage, fakePdf, guest, makeBranch, makeUser, realImage } from "./helpers.js";

/** ลายเซ็นของฉัน (user_signatures): อัปโหลด/วาด → ประมวลผล → เก็บเข้ารหัส + ประวัติ, การเข้าถึง, การนำไปใช้ในใบแจ้งงาน */

const signatures = (userId: number) => select<{ id: number; is_active: boolean; source: string; file_ref: string; size: number }>("SELECT * FROM user_signatures WHERE user_id = ? ORDER BY id", [userId]);

afterEach(() => setUpstreamTestHooks(null));

describe("my signature", () => {
  it("rejects wrong types, oversize files and fake extensions (content is checked, not the name)", async () => {
    const api = await as(await makeUser(), "th");
    const pdf = await api.post("/api/v1/auth/me/signature").attach("signature", fakePdf(5), "sig.pdf");
    expect(pdf.status).toBe(422);
    const big = await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(1500, "png"), "big.png");
    expect(big.body.errors.signature[0]).toBe("ลายเซ็นต้องมีขนาดไม่เกิน 1024 KB");
    const fakeExt = await api.post("/api/v1/auth/me/signature").attach("signature", Buffer.from("not really an image"), "sig.jpg");
    expect(fakeExt.status).toBe(422);
    // หัวไฟล์เป็น PNG แต่เนื้อในเสีย → decode ไม่ได้
    expect((await api.post("/api/v1/auth/me/signature").attach("signature", fakeImage(20, "png"), "broken.png")).body.errors.signature[0]).toBe("อ่านไฟล์รูปไม่ได้ กรุณาใช้ไฟล์อื่น");
    // รูปว่าง (ไม่มีลายเส้น)
    expect((await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(400, 200, "png", null), "empty.png")).body.errors.signature[0]).toBe("ไม่พบลายเส้นในรูป กรุณาเซ็นใหม่");
  });

  it("drawn PNG is cropped, resized to ≤ 600px, re-encoded and stored encrypted under a UUID name", async () => {
    const u = await makeUser();
    const api = await as(u);
    const res = await api.post("/api/v1/auth/me/signature").field("source", "DRAW").attach("signature", await realImage(1600, 600, "png", { w: 1000, h: 200 }), "my name.png");
    expect(res.status).toBe(200);
    const [row] = await signatures(u.id);
    expect(row).toMatchObject({ source: "DRAW", is_active: true });
    expect(row.file_ref).toMatch(new RegExp(`^signatures/${u.id}/[0-9a-f-]{36}\\.png\\.enc$`));
    expect(res.body.data.signature_url).toBe(`/auth/me/signature?v=${row.id}`);

    // ไฟล์บนดิสก์ถูกเข้ารหัส (ไม่ใช่ PNG ตรงๆ)
    const raw = (await readStoredBuffer(row.file_ref))!;
    expect(raw.subarray(0, 4).toString("hex")).not.toBe("89504e47");

    // ดึงผ่าน endpoint ที่ตรวจสิทธิ์: PNG ที่ crop ขอบว่าง + ย่อกว้าง 600 + ไม่มี metadata
    const img = await api.get("/api/v1/auth/me/signature").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(img.headers["content-type"]).toBe("image/png");
    const meta = await sharp(img.body as Buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(120); // 1000x200 หลัง crop → ย่อเหลือ 600x120
    expect(meta.exif).toBeUndefined();
  });

  it("uploaded JPG works too; a new signature makes the old one inactive (history kept, nothing deleted)", async () => {
    const u = await makeUser();
    const api = await as(u);
    await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(800, 300, "jpg"), "sig.jpg");
    await api.put("/api/v1/auth/me/signature").field("source", "DRAW").attach("signature", await realImage(), "sig.png");
    const rows = await signatures(u.id);
    expect(rows.map((r) => [r.source, r.is_active])).toEqual([["UPLOAD", false], ["DRAW", true]]);
    expect(await readStoredBuffer(rows[0].file_ref)).not.toBeNull(); // ไฟล์เดิมยังอยู่

    expect((await api.delete("/api/v1/auth/me/signature")).status).toBe(204);
    expect((await signatures(u.id)).every((r) => !r.is_active)).toBe(true);
    expect(await scalar("SELECT COUNT(*) FROM user_signatures WHERE user_id = ?", [u.id])).toBe(2);
    expect((await api.get("/api/v1/auth/me/signature")).status).toBe(404);

    const actions = (await select<{ action: string }>("SELECT action FROM audit_logs WHERE subject_id = ? ORDER BY id", [String(u.id)])).map((a) => a.action);
    expect(actions).toEqual(["signature.uploaded", "signature.changed", "signature.deleted"]);
  });

  it("nobody else can see a user's signature; only local admins see the status and can remove it (audited)", async () => {
    const owner = await makeUser();
    await (await as(owner)).post("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig.png");

    const admin = await as(await makeUser({ role: "admin" }));
    const view = (await admin.get(`/api/v1/users/${owner.id}`)).body.data;
    expect(view).toMatchObject({ signature_url: null, has_signature: true });

    const manager = await as(await makeUser({ role: "manager" }));
    expect((await manager.delete(`/api/v1/users/${owner.id}/signature`)).status).toBe(403);
    expect((await admin.delete(`/api/v1/users/${owner.id}/signature`)).status).toBe(204);
    expect((await admin.get(`/api/v1/users/${owner.id}`)).body.data.has_signature).toBe(false);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'signature.deleted_by_admin'")).toBe(1);
  });

  it("needs signature.manage_own and is rate limited", async () => {
    const u = await makeUser();
    const api = await as(u);
    await exec("DELETE FROM role_permissions WHERE role = 'viewer' AND permission_id = (SELECT id FROM permissions WHERE \"key\" = 'signature.manage_own')");
    expect((await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig.png")).status).toBe(403);
    expect((await api.get("/api/v1/auth/me/signature")).status).toBe(403);

    const other = await as(await makeUser({ role: "manager" }));
    const png = await realImage(300, 100, "png", { w: 100, h: 30 });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await other.post("/api/v1/auth/me/signature").attach("signature", png, "s.png")).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("JIT profile sync never touches signatures, and managing a signature never calls the source system", async () => {
    const calls: string[] = [];
    setUpstreamTestHooks({ resolve: async () => ["93.184.216.34"], transport: async (r: UpstreamHttpRequest) => (calls.push(r.url), { status: 500, headers: {}, body: "" }) });
    const conn = await insert("api_connections", { name: "HR", is_enabled: true, base_url: "https://hr.example.com", login_path: "/login", created_at: nowDb(), updated_at: nowDb() });
    const id = await insert("users", { name: "API", role: "viewer", type: "API", connection_id: conn, external_id: "E1", created_at: nowDb(), updated_at: nowDb() });
    const token = await createToken(id, "t", null);
    await insert("external_sessions", { token_id: token.id, user_id: id, connection_id: conn, access_token: encryptString("x"), expires_at: toDbDateTime(new Date(Date.now() + 3600_000)), profile_checked_at: nowDb(), created_at: nowDb(), updated_at: nowDb() });
    const auth = (r: ReturnType<ReturnType<typeof guest>["post"]>) => r.set("Authorization", `Bearer ${token.plainText}`).set("Accept", "application/json");

    expect((await auth(guest().post("/api/v1/auth/me/signature")).attach("signature", await realImage(), "sig.png")).status).toBe(200);
    expect(calls).toHaveLength(0);

    const conn_ = (await first<ApiConnectionRow>("SELECT * FROM api_connections WHERE id = ?", [conn]))!;
    await provisionUser(conn_, { external_id: "E1", name: "ชื่อใหม่", name_from_login: false, email: null, role_code: null, role: "viewer" }, {});
    expect((await signatures(id)).filter((r) => r.is_active)).toHaveLength(1);
    expect((await first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!.name).toBe("ชื่อใหม่");
  });
});

describe("signatures in IT tickets", () => {
  it("submitting stamps a copy (backend embeds it, audited); the copy survives deleting the signature", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ name: "Staff" });
    const api = await as(staff);
    const assignee = await makeUser({ is_it_staff: true });
    const submit = () => api.post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "ติดตั้งโปรแกรม", assignee_id: assignee.id });

    const noSig = await submit();
    expect(noSig.status).toBe(201);
    expect(noSig.body.data.signatures.requester).toBeNull();

    await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig.png");
    const withSig = await submit();
    const path = await scalar<string>("SELECT requester_signature FROM it_tickets WHERE uuid = ?", [withSig.body.data.id]);
    expect(path).toMatch(/^tickets\/[0-9a-f-]{36}\/signatures\/requester-[A-Za-z0-9]{16}\.png$/);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'signature.used'")).toBe(1);

    await api.delete("/api/v1/auth/me/signature");
    const file = await api.get(`/api/v1/tickets/${withSig.body.data.id}/files/requester-signature`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
  });

  it("old tickets without a copy show the requester's current signature only to the requester or holders of signature.use", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ name: "Staff" });
    const api = await as(staff);
    const it_ = await makeUser({ is_it_staff: true });
    const ticket = (await api.post("/api/v1/tickets").send({ type: "install", branch_id: branch, details: "x", assignee_id: it_.id })).body.data.id;
    await api.post("/api/v1/auth/me/signature").attach("signature", await realImage(), "sig.png");
    const url = `/api/v1/tickets/${ticket}/files/requester-signature`;

    expect((await api.get(url)).status).toBe(200); // เจ้าของ
    const admin = await makeUser({ role: "admin" });
    await exec("UPDATE it_tickets SET status = 'approved' WHERE uuid = ?", [ticket]);
    expect((await (await as(it_)).get(url)).status).toBe(404); // เห็นใบงานได้ แต่ไม่มีสิทธิ์ใช้ลายเซ็นคนอื่น
    expect((await (await as(admin)).get(url)).status).toBe(200); // signature.use
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'signature.used'")).toBe(1);
  });
});
