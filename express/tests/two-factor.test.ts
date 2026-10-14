import { describe, expect, it } from "vitest";
import { exec, scalar } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { base32Decode, base32Encode, currentStep, totpAt } from "../src/services/two-factor.js";
import { as, guest, makeUser } from "./helpers.js";

const codeFor = (secret: string, offset = 0) => totpAt(base32Decode(secret), currentStep() + offset);
const login = (email: string, password = "Secret123") => guest().post("/api/v1/auth/login").send({ email, password, device_name: "test" });

describe("two-factor authentication (TOTP)", () => {
  it("matches the RFC 6238 test vectors and round-trips base32", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("enable from the profile → login asks for a code; codes cannot be replayed; recovery codes work once", async () => {
    const user = await makeUser({ email: "tfa@corp.test", password: "Secret123" });
    const api = await as(user, "th");
    expect((await api.post("/api/v1/auth/2fa/setup").send({ password: "wrong" })).status).toBe(422);
    const setup = (await api.post("/api/v1/auth/2fa/setup").send({ password: "Secret123" })).body.data;
    expect(setup.otpauth_uri).toContain("otpauth://totp/");
    expect(setup.qr_svg).toContain("<svg");
    expect((await api.post("/api/v1/auth/2fa/confirm").send({ code: "000000" })).status).toBe(422);
    const confirmed = await api.post("/api/v1/auth/2fa/confirm").send({ code: codeFor(setup.secret) });
    expect(confirmed.body.data.recovery_codes).toHaveLength(8);
    expect((await api.get("/api/v1/auth/2fa")).body.data).toMatchObject({ enabled: true, recovery_codes_left: 8, required: false });
    // secret / recovery codes ไม่ออกไปกับข้อมูลผู้ใช้
    const meBody = (await api.get("/api/v1/auth/me")).body.data;
    expect(meBody.two_factor_enabled).toBe(true);
    expect(JSON.stringify(meBody)).not.toContain("two_factor_secret");

    // login: รหัสผ่านถูก → ยังไม่ได้ token, ได้ challenge
    const first = await login("tfa@corp.test");
    expect(first.body).toMatchObject({ two_factor: "verify" });
    expect(first.body.token).toBeUndefined();
    const challenge = first.body.challenge as string;
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge, code: "123456", device_name: "test" })).status).toBe(422);
    // แก้ challenge = ใช้ไม่ได้
    const tampered = challenge.replace(/^./, (c) => (c === "e" ? "f" : "e"));
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge: tampered, code: codeFor(setup.secret, 1), device_name: "test" })).status).toBe(422);
    // รหัสช่วงถัดไป (ช่วงปัจจุบันถูกใช้ตอนยืนยันแล้ว — ใช้ซ้ำไม่ได้)
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge, code: codeFor(setup.secret), device_name: "test" })).status).toBe(422);
    const ok = await guest().post("/api/v1/auth/login/2fa").send({ challenge, code: codeFor(setup.secret, 1), device_name: "test" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge, code: codeFor(setup.secret, 1), device_name: "test" })).status).toBe(422);

    // recovery code ใช้ได้ครั้งเดียว
    const recovery = confirmed.body.data.recovery_codes[0] as string;
    const c2 = (await login("tfa@corp.test")).body.challenge;
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge: c2, recovery_code: recovery.toLowerCase(), device_name: "test" })).status).toBe(200);
    expect((await guest().post("/api/v1/auth/login/2fa").send({ challenge: c2, recovery_code: recovery, device_name: "test" })).status).toBe(422);
    expect((await api.get("/api/v1/auth/2fa")).body.data.recovery_codes_left).toBe(7);

    // ปิด 2FA: ต้องทั้งรหัสผ่านและรหัสจากแอป (ล้างตัวนับ rate limit 5 ครั้ง/นาที ที่ใช้ไปข้างบน)
    resetRateLimits();
    await exec("UPDATE users SET two_factor_last_step = NULL WHERE id = ?", [user.id]);
    expect((await api.delete("/api/v1/auth/2fa").send({ password: "Secret123", code: "000000" })).status).toBe(422);
    expect((await api.delete("/api/v1/auth/2fa").send({ password: "Secret123", code: codeFor(setup.secret) })).status).toBe(204);
    expect((await login("tfa@corp.test")).body.token).toBeTruthy();
    const actions = await scalar<number>("SELECT COUNT(*) FROM audit_logs WHERE action IN ('two_factor.enabled', 'two_factor.recovery_used', 'two_factor.disabled', 'auth.2fa_failed')");
    expect(Number(actions)).toBeGreaterThanOrEqual(4);
  });

  it("when required, administrators must set up 2FA during login and cannot turn it off; super admins can reset it", async () => {
    const superAdmin = await as(await makeUser({ role: "super_admin" }));
    const viewer = await as(await makeUser());
    const adminUser = await makeUser({ role: "admin", email: "boss@corp.test", password: "Secret123" });
    await makeUser({ email: "plain@corp.test", password: "Secret123" });
    expect((await viewer.put("/api/v1/settings").send({ two_factor_required: true })).status).toBe(403);
    expect((await superAdmin.put("/api/v1/settings").send({ two_factor_required: true })).status).toBe(200);

    // พนักงานทั่วไปไม่ถูกบังคับ
    expect((await login("plain@corp.test")).body.token).toBeTruthy();
    // ผู้ดูแลระบบ: ต้องตั้ง 2FA ก่อนได้ token
    const first = await login("boss@corp.test");
    expect(first.body).toMatchObject({ two_factor: "setup" });
    const setup = (await guest().post("/api/v1/auth/login/2fa/setup").send({ challenge: first.body.challenge })).body.data;
    expect(setup.qr_svg).toContain("<svg");
    const done = await guest().post("/api/v1/auth/login/2fa").send({ challenge: first.body.challenge, code: codeFor(setup.secret), device_name: "test" });
    expect(done.status).toBe(200);
    expect(done.body.token).toBeTruthy();
    expect(done.body.recovery_codes).toHaveLength(8);
    // ถูกบังคับอยู่ = ปิดเองไม่ได้
    const adminApi = await as(adminUser);
    await exec("UPDATE users SET two_factor_last_step = NULL WHERE id = ?", [adminUser.id]);
    expect((await adminApi.delete("/api/v1/auth/2fa").send({ password: "Secret123", code: codeFor(setup.secret) })).status).toBe(422);
    // รีเซ็ตให้ผู้อื่น: เฉพาะ access.manage
    expect((await viewer.delete(`/api/v1/users/${adminUser.id}/2fa`)).status).toBe(403);
    expect((await superAdmin.delete(`/api/v1/users/${adminUser.id}/2fa`)).status).toBe(204);
    expect((await login("boss@corp.test")).body.two_factor).toBe("setup");
  });
});
