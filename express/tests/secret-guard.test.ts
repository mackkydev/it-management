import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { ipAllowed, isValidIpEntry } from "../src/services/secret-guard.js";
import { as, day, makeUser } from "./helpers.js";

/** ความปลอดภัยตอนเปิดดูรหัสผ่าน (คลังบัญชี) / License key — สวิตช์ใน app_settings.secret_guard */

async function setup() {
  const head = await makeUser({ is_it_staff: true, is_it_head: true, name: "หัวหน้า IT" });
  const staff = await makeUser({ is_it_staff: true, name: "เจ้าหน้าที่ IT" });
  const admin = await as(await makeUser({ role: "admin" }));
  const api = await as(staff);
  const id = (await api.post("/api/v1/credentials").send({ title: "Firewall", category: "network", username: "admin", password: "S3cret!pass" })).body.data.id;
  return { head, staff, admin, api, id };
}

const notifications = (userId: number) => scalar("SELECT COUNT(*) FROM notifications WHERE notifiable_id = ? AND type = 'App\\\\Notifications\\\\SecretRevealed'", [userId]).then(Number);

describe("secret guard", () => {
  it("default: password confirmation is required, wrong password is audited, and IT heads are notified", async () => {
    const { head, staff, api, id } = await setup();

    const first428 = await api.post(`/api/v1/credentials/${id}/reveal`);
    expect(first428.status).toBe(428);
    expect(first428.body.message).toBe("กรุณายืนยันรหัสผ่านของคุณก่อนเปิดดู");

    expect((await api.post("/api/v1/auth/reauth").send({ password: "wrong" })).status).toBe(422);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'auth.reauth_failed' AND subject_id = ?", [String(staff.id)])).toBeTruthy();

    expect((await api.post("/api/v1/auth/reauth").send({ password: "password" })).status).toBe(204);
    const ok = await api.post(`/api/v1/credentials/${id}/reveal`).set("X-Forwarded-For", "10.1.2.3");
    expect(ok.body.data.password).toBe("S3cret!pass");
    // log บันทึก IP จริงที่ frontend ส่งต่อ
    expect((await api.get(`/api/v1/credentials/${id}/logs`)).body.data[0]).toMatchObject({ action: "reveal", ip: "10.1.2.3" });
    // แจ้งหัวหน้า IT — ไม่แจ้งคนที่เปิดดูเอง
    expect(await notifications(head.id)).toBe(1);
    expect(await notifications(staff.id)).toBe(0);
    const note = await first<{ data: Record<string, unknown> }>("SELECT data FROM notifications WHERE notifiable_id = ?", [head.id]);
    expect(JSON.parse(String(note!.data))).toMatchObject({ kind: "secret_revealed", secret: "vault", title: "Firewall", actor: "เจ้าหน้าที่ IT", ip: "10.1.2.3" });

    // ยืนยันไว้นานเกินเวลาที่ตั้ง (5 นาที) → ต้องยืนยันใหม่
    await exec("UPDATE personal_access_tokens SET reauth_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 MINUTE) WHERE tokenable_id = ?", [staff.id]);
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(428);
  });

  it("each protection can be switched off / on independently (admin only)", async () => {
    const { head, admin, api, id } = await setup();
    expect((await api.put("/api/v1/settings").send({ secret_guard: { reauth: false } })).status).toBe(403);

    const off = await admin.put("/api/v1/settings").send({ secret_guard: { reauth: false, notify_heads: false } });
    expect(off.body.data.secret_guard).toEqual({ reauth: false, reauth_method: "password", reauth_minutes: 5, ip_restrict: false, allowed_ips: [], notify_heads: false });
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(200);
    expect(await notifications(head.id)).toBe(0);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.secret_guard_updated'")).toBeTruthy();

    // จำกัด IP: ต้องมีอย่างน้อย 1 รายการ / รูปแบบต้องถูก
    const errors = async (g: Record<string, unknown>) => Object.keys((await admin.put("/api/v1/settings").send({ secret_guard: g })).body.errors ?? {});
    expect(await errors({ ip_restrict: true })).toEqual(["secret_guard.allowed_ips"]);
    expect(await errors({ ip_restrict: true, allowed_ips: ["10.0.0.0/33"] })).toEqual(["secret_guard.allowed_ips.0"]);
    expect((await admin.put("/api/v1/settings").send({ secret_guard: { ip_restrict: true, allowed_ips: ["10.0.0.0/8", "192.168.1.20"] } })).status).toBe(200);

    const blocked = await api.post(`/api/v1/credentials/${id}/reveal`).set("X-Forwarded-For", "192.168.5.5");
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain("192.168.5.5");
    expect((await api.post(`/api/v1/credentials/${id}/reveal`).set("X-Forwarded-For", "10.20.30.40")).status).toBe(200);
    expect((await api.post(`/api/v1/credentials/${id}/reveal`).set("X-Forwarded-For", "192.168.1.20")).status).toBe(200);
  });

  it("license keys follow the same rules and every view is audited", async () => {
    const head = await makeUser({ is_it_head: true, is_it_staff: true });
    const manager = await makeUser({ role: "manager" });
    const api = await as(manager);
    const created = await api.post("/api/v1/assets").send({
      asset_tag: "SW-1", name: "Office", category: "SOFTWARE",
      license: { billing: "yearly", start_date: day(0), expires_at: day(364), license_key: "AAAA-BBBB" },
    });
    const id = created.body.data.id;
    expect((await api.post(`/api/v1/assets/${id}/license-key`)).status).toBe(428);
    await api.post("/api/v1/auth/reauth").send({ password: "password" });
    expect((await api.post(`/api/v1/assets/${id}/license-key`)).body.data.license_key).toBe("AAAA-BBBB");
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'asset.license_key_revealed'")).toBeTruthy();
    expect(await notifications(head.id)).toBe(1);
  });

  it("IP helpers", () => {
    expect(["10.0.0.0/8", "192.168.1.5", "fe80::/10", "::1"].every(isValidIpEntry)).toBe(true);
    expect(["10.0.0.0/33", "abc", "1.2.3.4/8/1", "printer.local"].some(isValidIpEntry)).toBe(false);
    expect(ipAllowed("::ffff:10.1.1.1", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("172.16.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed(undefined, ["10.0.0.0/8"])).toBe(false);
  });
});

describe("shared (central) PIN", () => {
  it("one PIN for everyone, set only by admins / granted staff with their login password; 5 wrong PINs lock that user for 15 minutes", async () => {
    const { staff, admin, api, id } = await setup();
    const other = await makeUser({ is_it_staff: true });
    const otherApi = await as(other);
    await admin.put("/api/v1/settings").send({ secret_guard: { reauth_method: "pin", notify_heads: false } });

    // ยังไม่ตั้ง PIN กลาง
    const notSet = await api.post(`/api/v1/credentials/${id}/reveal`);
    expect(notSet.status).toBe(428);
    expect(notSet.body).toMatchObject({ reauth: "pin", pin_set: false, pin_locked: false });
    expect((await api.get("/api/v1/secret-pin")).body.data).toEqual({ set: false, set_at: null, set_by: null, can_manage: false });

    // ตั้งได้เฉพาะผู้มีสิทธิ์ secrets.pin_manage (admin / มอบสิทธิ์รายคน)
    expect((await api.put("/api/v1/secret-pin").send({ password: "password", pin: "ab12", pin_confirmation: "ab12" })).status).toBe(403);
    const pinErrors = async (body: Record<string, unknown>) => Object.keys((await admin.put("/api/v1/secret-pin").send(body)).body.errors ?? {}).sort();
    expect(await pinErrors({ password: "password", pin: "12 3", pin_confirmation: "12 3" })).toEqual(["pin"]);
    expect(await pinErrors({ password: "password", pin: "ab12", pin_confirmation: "ab13" })).toEqual(["pin_confirmation"]);
    expect(await pinErrors({ password: "wrong", pin: "ab12", pin_confirmation: "ab12" })).toEqual(["password"]);
    const pid = await scalar<number>("SELECT id FROM permissions WHERE \"key\" = 'secrets.pin_manage'");
    await exec("INSERT INTO user_permissions (user_id, permission_id, effect, created_at) VALUES (?, ?, 'allow', NOW())", [staff.id, pid]);
    const set = await api.put("/api/v1/secret-pin").send({ password: "password", pin: "Ab-1234", pin_confirmation: "Ab-1234" });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ set: true, set_by: "เจ้าหน้าที่ IT", can_manage: true });

    // hash ไม่หลุดไปกับหน้าตั้งค่า
    const settings = (await admin.get("/api/v1/settings")).body.data;
    expect(settings.secret_pin).toBeUndefined();
    expect(settings.secret_pin_status).toMatchObject({ set: true });

    // ใช้ PIN กลางเดียวกันทุกคน — รหัสผ่าน login ใช้แทนไม่ได้
    expect(Object.keys((await api.post("/api/v1/auth/reauth").send({ password: "password" })).body.errors)).toEqual(["pin"]);
    expect((await api.post("/api/v1/auth/reauth").send({ pin: "Ab-1234" })).status).toBe(204);
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).body.data.password).toBe("S3cret!pass");
    expect((await otherApi.post("/api/v1/auth/reauth").send({ pin: "Ab-1234" })).status).toBe(204);

    // ผิด 5 ครั้งติด → ล็อกเฉพาะคนนั้น 15 นาที
    expect((await otherApi.post("/api/v1/auth/reauth").send({ pin: "nope" })).body.errors.pin[0]).toBe("PIN ไม่ถูกต้อง (กรอกได้อีก 4 ครั้ง)");
    for (let i = 0; i < 4; i++) await otherApi.post("/api/v1/auth/reauth").send({ pin: "nope" });
    expect((await otherApi.post("/api/v1/auth/reauth").send({ pin: "Ab-1234" })).body.errors.pin[0]).toBe("กรอก PIN ผิดหลายครั้ง — ลองใหม่ได้ในอีก 15 นาที");
    expect((await api.post("/api/v1/auth/reauth").send({ pin: "Ab-1234" })).status).toBe(204); // คนอื่นยังใช้ได้

    // เปลี่ยน PIN กลาง → ปลดล็อกทุกคน
    expect((await admin.put("/api/v1/secret-pin").send({ password: "password", pin: "new-PIN9", pin_confirmation: "new-PIN9" })).status).toBe(200);
    expect((await otherApi.post("/api/v1/auth/reauth").send({ pin: "new-PIN9" })).status).toBe(204);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.secret_pin_changed'")).toBeTruthy();
  });
});

describe("per-credential confirmation switch", () => {
  it("an entry with require_reauth off can be viewed without confirming; turning it on asks again", async () => {
    const { api } = await setup();
    const created = await api.post("/api/v1/credentials").send({ title: "WiFi guest", category: "network", password: "guest-1234", require_reauth: false });
    expect(created.body.data.require_reauth).toBe(false);
    const id = created.body.data.id;
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).body.data.password).toBe("guest-1234");
    expect((await api.get(`/api/v1/credentials/${id}/logs`)).body.data[0].action).toBe("reveal"); // ยังบันทึก log

    await api.put(`/api/v1/credentials/${id}`).send({ require_reauth: true });
    expect((await api.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(428);
    // ค่าเริ่มต้นของบัญชีใหม่ = ต้องยืนยัน
    expect((await api.post("/api/v1/credentials").send({ title: "Server", category: "server" })).body.data.require_reauth).toBe(true);
  });
});
