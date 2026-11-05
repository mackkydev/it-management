import { describe, expect, it } from "vitest";
import { exec, first, scalar } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { as, guest, makeUser } from "./helpers.js";

/** ล็อกเมื่อไม่เข้าระบบรายกลุ่ม, ประวัติการเข้าสู่ระบบ, ปลดล็อก, ติ๊กให้ตั้งรหัสผ่านใหม่ */
const login = (email: string, password = "password") => {
  resetRateLimits();
  return guest().post("/api/v1/auth/login").send({ email, password, device_name: "test" });
};
const longAgo = "2020-01-01 00:00:00";
/** ทำให้บัญชีเก่า และกลุ่มถูกเปิดมานานแล้ว (จำลองเวลาที่ผ่านไป) */
async function age(userId: number, groups: string[]) {
  await exec("UPDATE users SET created_at = ?, last_login_at = NULL, inactive_unlocked_at = NULL WHERE id = ?", [longAgo, userId]);
  const raw = await scalar("SELECT value FROM app_settings WHERE `key` = 'password_policy'");
  const value = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
  value.inactive_lock_groups = Object.fromEntries(groups.map((g) => [g, longAgo]));
  await exec("UPDATE app_settings SET value = ? WHERE `key` = 'password_policy'", [JSON.stringify(value)]);
}

describe("inactivity lock by group", () => {
  it("only access.manage can set it; turning it on locks nobody right away; a stale user in a switched-on group is locked", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const staff = await makeUser({ email: "staff1@example.com" });
    await exec("UPDATE users SET created_at = ? WHERE id = ?", [longAgo, staff.id]);

    expect((await (await as(await makeUser({ role: "manager" }))).put("/api/v1/settings").send({ password_policy: { inactive_lock_days: 30 } })).status).toBe(403);
    expect((await root.put("/api/v1/settings").send({ password_policy: { inactive_lock_days: 30, inactive_lock_groups: ["nope"] } })).status).toBe(422);
    expect((await root.put("/api/v1/settings").send({ password_policy: { inactive_lock_days: 30, inactive_lock_groups: ["viewer", "super_admin"] } })).status).toBe(200);
    const policy = (await root.get("/api/v1/settings")).body.data.password_policy;
    expect(policy.inactive_lock_days).toBe(30);
    expect(Object.keys(policy.inactive_lock_groups)).toEqual(["viewer"]); // super_admin ไม่ถูกเก็บไว้เป็นกลุ่มที่ล็อก

    // เพิ่งเปิด = บัญชีเก่าก็ยังเข้าได้
    expect((await login("staff1@example.com")).status).toBe(200);
    expect(await scalar("SELECT last_login_at IS NOT NULL FROM users WHERE id = ?", [staff.id])).toBeTruthy();

    // ผ่านไปนานแล้วไม่เข้าระบบ = ล็อก และบันทึกครั้งเดียว
    await age(staff.id, ["viewer"]);
    const blocked = await login("staff1@example.com");
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors.email[0]).toContain("30");
    await login("staff1@example.com");
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.locked_inactive' AND subject_id = ?", [String(staff.id)])).toBe(1);
    expect(await first("SELECT last_lock_reason FROM users WHERE id = ?", [staff.id])).toMatchObject({ last_lock_reason: "inactive" });
    // รหัสผ่านผิด = ไม่บอกว่าถูกล็อก
    expect((await login("staff1@example.com", "wrong")).body.errors.email[0]).not.toContain("30");
  });

  it("a group switched off or a recent login is not locked; super admins are never locked", async () => {
    const root = await makeUser({ role: "super_admin", email: "root2@example.com" });
    const api = await as(root);
    const other = await makeUser({ role: "manager", email: "mgr@example.com" });
    const recent = await makeUser({ email: "recent@example.com" });
    await api.put("/api/v1/settings").send({ password_policy: { inactive_lock_days: 30, inactive_lock_groups: ["viewer"] } });

    await age(other.id, ["viewer"]);
    expect((await login("mgr@example.com")).status).toBe(200); // กลุ่มไม่ได้เปิด

    await age(recent.id, ["viewer"]);
    await exec("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [recent.id]);
    expect((await login("recent@example.com")).status).toBe(200); // เพิ่งเข้าระบบ

    await age(root.id, ["viewer", "super_admin"]);
    const signedIn = await login("root2@example.com");
    expect(signedIn.body.errors).toBeUndefined();
  });
});

describe("sign-in history and unlock", () => {
  it("shows failures and the last lock; only users.unlock can unlock; admins can by default", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const admin = await as(await makeUser({ role: "admin" }));
    const manager = await as(await makeUser({ role: "manager" }));
    const user = await makeUser({ email: "wrongpass@example.com" });
    await root.put("/api/v1/settings").send({ password_policy: { lockout_attempts: 2, lockout_minutes: 15 } });

    await login("wrongpass@example.com", "wrong");
    let meta = (await root.get(`/api/v1/users/${user.id}`)).body.meta.login_activity;
    expect(meta).toMatchObject({ failures: 1, last_locked_at: null, last_login_at: null });
    expect(meta.last_failed_at).toBeTruthy();

    await login("wrongpass@example.com", "wrong");
    const locked = (await root.get(`/api/v1/users/${user.id}`)).body;
    expect(locked.data.login_locked_until).toBeTruthy();
    meta = locked.meta.login_activity;
    expect(meta).toMatchObject({ failures: 0, last_lock_reason: "password", last_lock_attempts: 2 });
    expect(meta.last_locked_at).toBeTruthy();

    // คนที่เปิดดูตัวเองไม่เห็นประวัติ
    expect((await (await as(user)).get(`/api/v1/users/${user.id}`)).body.meta?.login_activity).toBeUndefined();

    expect((await manager.delete(`/api/v1/users/${user.id}/login-lock`)).status).toBe(403);
    expect((await admin.delete(`/api/v1/users/${user.id}/login-lock`)).status).toBe(204);
    expect((await login("wrongpass@example.com")).status).toBe(200);
    expect((await admin.delete(`/api/v1/users/${user.id}/login-lock`)).status).toBe(404); // ไม่มีอะไรให้ปลด
  });

  it("unlocking an inactive user lets them sign in again", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const user = await makeUser({ email: "idle@example.com" });
    await root.put("/api/v1/settings").send({ password_policy: { inactive_lock_days: 30, inactive_lock_groups: ["viewer"] } });
    await age(user.id, ["viewer"]);
    expect((await login("idle@example.com")).status).toBe(422);
    expect((await root.get(`/api/v1/users/${user.id}`)).body.meta.login_activity.inactive_locked).toBe(true);

    expect((await root.delete(`/api/v1/users/${user.id}/login-lock`)).status).toBe(204);
    expect((await root.get(`/api/v1/users/${user.id}`)).body.meta.login_activity.inactive_locked).toBe(false);
    expect((await login("idle@example.com")).status).toBe(200);
  });
});

describe("force a new password when an admin sets one", () => {
  const body = { name: "ผู้ใช้ใหม่", role: "viewer", password: "Admin1234", password_confirmation: "Admin1234" };

  it("ticked = must change at sign-in even with the policy off; changing it clears the flag; unticked = free to use", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const ticked = await root.post("/api/v1/users").send({ ...body, email: "ticked@example.com", must_change_password: true });
    expect(ticked.status).toBe(201);
    const signIn = await login("ticked@example.com", "Admin1234");
    expect(signIn.body).toMatchObject({ password_change_required: true, password_expired: true });
    const token = signIn.body.token as string;
    const call = (path: string) => guest().get(path).set("Authorization", `Bearer ${token}`);
    expect((await call("/api/v1/tickets")).body.code).toBe("password_expired");
    const changed = await guest().put("/api/v1/auth/password").set("Authorization", `Bearer ${token}`).send({ current_password: "Admin1234", password: "Mine12345", password_confirmation: "Mine12345" });
    expect(changed.status).toBe(204);
    expect(await scalar("SELECT password_change_forced FROM users WHERE id = ?", [ticked.body.data.id])).toBeFalsy();
    expect((await call("/api/v1/tickets")).status).toBe(200);

    const unticked = await root.post("/api/v1/users").send({ ...body, email: "free@example.com", must_change_password: false });
    expect(unticked.status).toBe(201);
    expect((await login("free@example.com", "Admin1234")).body).toMatchObject({ password_change_required: false });
  });

  it("resetting another user's password honours the tick and unlocks them", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const user = await makeUser({ email: "reset@example.com", name: "รีเซ็ต" });
    await exec("UPDATE users SET login_locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE id = ?", [user.id]);
    const res = await root.put(`/api/v1/users/${user.id}`).send({ name: user.name, email: user.email, role: user.role, password: "Reset1234", password_confirmation: "Reset1234", must_change_password: true });
    expect(res.status).toBe(200);
    expect((await login("reset@example.com", "Reset1234")).body).toMatchObject({ password_change_required: true });
  });
});
