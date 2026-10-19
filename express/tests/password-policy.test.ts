import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { base32Decode, currentStep, totpAt } from "../src/services/two-factor.js";
import { as, guest, makeUser } from "./helpers.js";

/** นโยบายรหัสผ่าน (app_settings.password_policy — services/password-policy.ts): ล็อกบัญชีเมื่อ login ผิด + บังคับเปลี่ยนรหัสผ่านทุก N วัน */

const login = (email: string, password: string) => {
  resetRateLimits();
  return guest().post("/api/v1/auth/login").send({ email, password, device_name: "test" });
};
const superAdmin = async () => as(await makeUser({ role: "super_admin" }));

describe("password policy", () => {
  it("defaults: lockout after 10 failures for 15 minutes, no password expiry", async () => {
    const api = await superAdmin();
    const s = (await api.get("/api/v1/settings")).body.data.password_policy;
    expect(s).toEqual({ lockout_attempts: 10, lockout_minutes: 15, expiry_days: 0, expiry_warn_days: 7, since: null });
  });

  it("locks the account after N failed sign-ins, even with the right password, and notifies admins", async () => {
    const root = await superAdmin();
    const admin = await makeUser({ role: "admin" });
    expect((await root.put("/api/v1/settings").send({ password_policy: { lockout_attempts: 3, lockout_minutes: 10 } })).status).toBe(200);
    const u = await makeUser({ email: "lock@test.local", password: "Right1234" });

    for (let i = 0; i < 2; i++) {
      const r = await login("lock@test.local", "wrong");
      expect(r.status).toBe(422);
      expect(r.body.errors.email[0]).toBe("อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง");
    }
    const third = await login("lock@test.local", "wrong");
    expect(third.body.errors.email[0]).toContain("ถูกล็อกชั่วคราว");
    // ระหว่างล็อก รหัสผ่านถูกก็เข้าไม่ได้
    const right = await login("lock@test.local", "Right1234");
    expect(right.status).toBe(422);
    expect(right.body.errors.email[0]).toContain("10 นาที");

    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'auth.locked' AND subject_id = ?", [String(u.id)])).toBeTruthy();
    const note = await first<{ data: string }>("SELECT data FROM notifications WHERE notifiable_id = ? AND type = 'App\\\\Notifications\\\\AccountLocked'", [admin.id]);
    expect(JSON.parse(String(note!.data))).toMatchObject({ kind: "account_locked", subject_id: u.id, attempts: 3, minutes: 10 });

    // ผู้ดูแลเห็นสถานะล็อก แล้วปลดล็อก (audit)
    expect((await root.get(`/api/v1/users/${u.id}`)).body.data.login_locked_until).toBeTruthy();
    expect((await root.delete(`/api/v1/users/${u.id}/login-lock`)).status).toBe(204);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'auth.unlocked'")).toBeTruthy();
    expect((await login("lock@test.local", "Right1234")).body.token).toBeTruthy();
    expect(Number(await scalar("SELECT login_failures FROM users WHERE id = ?", [u.id]))).toBe(0);
  });

  it("the lock expires on its own, a successful sign-in resets the counter, and 0 turns lockout off", async () => {
    const root = await superAdmin();
    await root.put("/api/v1/settings").send({ password_policy: { lockout_attempts: 2 } });
    const u = await makeUser({ email: "count@test.local", password: "Right1234" });

    await login("count@test.local", "wrong");
    expect((await login("count@test.local", "Right1234")).body.token).toBeTruthy();
    // ล้างตัวนับแล้ว → ผิดอีก 1 ครั้งยังไม่ล็อก
    expect((await login("count@test.local", "wrong")).body.errors.email[0]).not.toContain("ล็อก");

    await login("count@test.local", "wrong");
    expect((await login("count@test.local", "Right1234")).status).toBe(422);
    await exec("UPDATE users SET login_locked_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?", [u.id]);
    expect((await login("count@test.local", "Right1234")).body.token).toBeTruthy();

    await root.put("/api/v1/settings").send({ password_policy: { lockout_attempts: 0 } });
    for (let i = 0; i < 4; i++) await login("count@test.local", "wrong");
    expect((await login("count@test.local", "Right1234")).body.token).toBeTruthy();
  });

  it("only access.manage can change the policy, and changes are audited", async () => {
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.put("/api/v1/settings").send({ password_policy: { expiry_days: 90 } })).status).toBe(403);
    const root = await superAdmin();
    const bad = await root.put("/api/v1/settings").send({ password_policy: { expiry_days: 9999, lockout_minutes: 0 } });
    expect(Object.keys(bad.body.errors).sort()).toEqual(["password_policy.expiry_days", "password_policy.lockout_minutes"]);
    expect((await root.put("/api/v1/settings").send({ password_policy: { expiry_days: 90 } })).status).toBe(200);
    expect(await first("SELECT 1 FROM audit_logs WHERE action = 'settings.password_policy_updated'")).toBeTruthy();
  });

  it("forces a password change after N days: only /auth/me, password change and logout work until then", async () => {
    const root = await superAdmin();
    const u = await makeUser({ password: "Old12345" });
    const api = await as(u);

    const on = await root.put("/api/v1/settings").send({ password_policy: { expiry_days: 30 } });
    // เพิ่งเปิด → ผู้ใช้เดิมเริ่มนับจากวันนี้ (ยังไม่หมดอายุ)
    expect(on.body.data.password_policy.since).toBeTruthy();
    const me1 = (await api.get("/api/v1/auth/me")).body.data;
    expect(me1.password_expired).toBe(false);
    expect(me1.password_expires_at).toBeTruthy();
    expect(me1.password_warn).toBe(false);
    // เหลือไม่ถึง 7 วัน (ค่าเริ่มต้นแจ้งล่วงหน้า) → เตือน
    await exec("UPDATE users SET password_changed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 25 DAY) WHERE id = ?", [u.id]);
    expect((await api.get("/api/v1/auth/me")).body.data).toMatchObject({ password_warn: true, password_expired: false });
    expect((await api.get("/api/v1/notifications")).status).toBe(200);

    // เปลี่ยนรหัสผ่านล่าสุดเมื่อ 31 วันก่อน → หมดอายุ
    await exec("UPDATE users SET password_changed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE id = ?", [u.id]);
    expect((await api.get("/api/v1/auth/me")).body.data.password_expired).toBe(true);
    const blocked = await api.get("/api/v1/notifications");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("password_expired");

    expect((await api.put("/api/v1/auth/password").send({ current_password: "Old12345", password: "New12345", password_confirmation: "New12345" })).status).toBe(204);
    const fresh = await as((await first("SELECT * FROM users WHERE id = ?", [u.id]))!);
    expect((await fresh.get("/api/v1/auth/me")).body.data.password_expired).toBe(false);
    expect((await fresh.get("/api/v1/notifications")).status).toBe(200);
  });

  it("an admin password reset restarts the clock and clears the lock", async () => {
    const root = await superAdmin();
    await root.put("/api/v1/settings").send({ password_policy: { expiry_days: 30 } });
    const u = await makeUser({ email: "reset@test.local" });
    await exec("UPDATE users SET password_changed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY), login_failures = 4, login_locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE id = ?", [u.id]);
    expect((await root.put(`/api/v1/users/${u.id}`).send({ password: "Reset1234" })).status).toBe(200);
    const row = await first<{ login_failures: number; login_locked_until: string | null }>("SELECT login_failures, login_locked_until FROM users WHERE id = ?", [u.id]);
    expect(row).toMatchObject({ login_failures: 0, login_locked_until: null });
    const r = await login("reset@test.local", "Reset1234");
    expect(r.body.token).toBeTruthy();
    expect(r.body.user.login_locked_until).toBeNull();
  });

  it("wrong 2FA codes count towards the same lock", async () => {
    const root = await superAdmin();
    await root.put("/api/v1/settings").send({ password_policy: { lockout_attempts: 3 } });
    const u = await makeUser({ email: "tfa-lock@test.local", password: "Secret123" });
    const api = await as(u, "th");
    const secret = (await api.post("/api/v1/auth/2fa/setup").send({ password: "Secret123" })).body.data.secret as string;
    const code = (offset = 0) => totpAt(base32Decode(secret), currentStep() + offset);
    expect((await api.post("/api/v1/auth/2fa/confirm").send({ code: code() })).status).toBe(200);

    const challenge = (await login("tfa-lock@test.local", "Secret123")).body.challenge as string;
    const verify = (c: string) => {
      resetRateLimits();
      return guest().post("/api/v1/auth/login/2fa").send({ challenge, code: c, device_name: "test" });
    };
    await verify("000000");
    await verify("000001");
    expect((await verify("000002")).body.errors.code[0]).toContain("ถูกล็อกชั่วคราว");
    // ล็อกแล้วรหัสถูกก็ใช้ไม่ได้ และ login ด้วยรหัสผ่านก็ถูกล็อก
    expect((await verify(code(1))).status).toBe(422);
    expect((await login("tfa-lock@test.local", "Secret123")).body.errors.email[0]).toContain("ถูกล็อกชั่วคราว");
  });
});
