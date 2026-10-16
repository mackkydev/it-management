import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { first, scalar } from "../src/db.js";
import { rekeyVault } from "../src/cli/vault-key.js";
import { decryptString } from "../src/lib/laravel-crypt.js";
import { useVaultKeyForTests } from "../src/services/vault-crypto.js";
import { as, makeUser } from "./helpers.js";

/** คลังบัญชีระดับ 1: สิทธิ์รายรายการ, กุญแจคลังแยกจาก APP_KEY (+ rekey), ยืนยันตัวตนทุกครั้งที่เปิดดู */

afterEach(() => useVaultKeyForTests(null));

const ids = (res: { body: { data: { id: number }[] } }) => res.body.data.map((c) => c.id);

describe("per-entry vault access", () => {
  it("restricted entries are visible only to chosen users / groups, the owner, the creator and vault.all", async () => {
    const creatorUser = await makeUser({ role: "admin", name: "ผู้สร้าง" });
    const chosenUser = await makeUser({ role: "admin", name: "คนที่เลือก" });
    const otherUser = await makeUser({ role: "admin", name: "คนอื่น" });
    const ownerUser = await makeUser({ role: "admin", name: "เจ้าของ" });
    const staffUser = await makeUser({ is_it_staff: true, name: "เจ้าหน้าที่ในกลุ่ม" });
    const auditor = await makeUser({ role: "super_admin" });
    const [creator, chosen, other, owner, staff, root] = await Promise.all([creatorUser, chosenUser, otherUser, ownerUser, staffUser, auditor].map((u) => as(u, "th")));
    await root.put("/api/v1/settings").send({ secret_guard: { reauth: false } });

    const open = (await creator.post("/api/v1/credentials").send({ title: "Wi-Fi ห้องประชุม", category: "network", password: "open-123" })).body.data;
    const created = await creator.post("/api/v1/credentials").send({
      title: "Firewall root", category: "network", password: "S3cret!", owner_id: ownerUser.id,
      access_mode: "restricted", access_user_ids: [chosenUser.id], access_groups: ["it_staff"],
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ access_mode: "restricted", access_users: [{ id: chosenUser.id, name: "คนที่เลือก" }], access_groups: ["it_staff"] });
    const secret = created.body.data.id;
    expect(await first("SELECT 1 AS x FROM audit_logs WHERE action = 'credential.access_updated' AND subject_id = ?", [String(secret)])).toBeTruthy();

    // ผู้ไม่มีสิทธิ์ไม่เห็นเลย (รายการ / ดู / เปิดดู / แก้ / ลบ / ประวัติ)
    expect(ids(await other.get("/api/v1/credentials"))).toEqual([open.id]);
    for (const [method, path] of [["get", ""], ["post", "/reveal"], ["get", "/logs"], ["put", ""], ["delete", ""]] as const) {
      expect((await other[method](`/api/v1/credentials/${secret}${path}`).send({ title: "x" })).status).toBe(404);
    }
    // คนที่เลือก / กลุ่มที่เลือก / เจ้าของ / ผู้สร้าง / ผู้ดูแลระบบสูงสุด เปิดดูได้
    for (const api of [chosen, staff, owner, creator, root]) {
      expect(ids(await api.get("/api/v1/credentials"))).toContain(secret);
      expect((await api.post(`/api/v1/credentials/${secret}/reveal`)).body.data.password).toBe("S3cret!");
    }

    // จำกัดสิทธิ์แล้วตัวเองต้องยังเข้าได้
    const lockOut = await chosen.put(`/api/v1/credentials/${secret}`).send({ access_mode: "restricted", access_user_ids: [], access_groups: [] });
    expect(lockOut.status).toBe(422);
    expect(Object.keys(lockOut.body.errors)).toEqual(["access_mode"]);
    expect((await creator.put(`/api/v1/credentials/${secret}`).send({ access_mode: "restricted", access_user_ids: [otherUser.id + 99999] })).status).toBe(422);
    // เปิดให้ทุกคน → คนอื่นเห็น
    expect((await creator.put(`/api/v1/credentials/${secret}`).send({ access_mode: "all" })).body.data).toMatchObject({ access_mode: "all", access_users: [], access_groups: [] });
    expect(ids(await other.get("/api/v1/credentials"))).toContain(secret);

    const options = (await creator.get("/api/v1/credentials/access-options")).body.data;
    expect(options.users.map((u: { id: number }) => u.id)).toContain(chosenUser.id);
    expect(options.groups.map((g: { key: string }) => g.key)).toContain("admin");
  });
});

describe("vault key", () => {
  it("new entries use the vault key; old APP_KEY entries still open and are moved by rekey", async () => {
    const admin = await makeUser({ role: "super_admin" });
    const api = await as(admin);
    await api.put("/api/v1/settings").send({ secret_guard: { reauth: false } });
    const legacy = (await api.post("/api/v1/credentials").send({ title: "เดิม", category: "system", password: "old-pass", secret_notes: "note" })).body.data.id;

    const key = randomBytes(32);
    useVaultKeyForTests(key);
    const fresh = (await api.post("/api/v1/credentials").send({ title: "ใหม่", category: "system", password: "new-pass" })).body.data.id;
    const raw = async (id: number) => String(await scalar("SELECT password FROM credentials WHERE id = ?", [id]));
    expect(decryptString(await raw(fresh), key)).toBe("new-pass");
    const freshRaw = await raw(fresh);
    expect(() => decryptString(freshRaw, config.appKey)).toThrow();
    // ข้อมูลเดิม (APP_KEY) ยังเปิดดูได้
    expect((await api.post(`/api/v1/credentials/${legacy}/reveal`)).body.data).toEqual({ password: "old-pass", secret_notes: "note" });

    expect(await rekeyVault({ dryRun: true })).toMatchObject({ checked: 2, rekeyed: 1, failed: [] });
    expect(decryptString(await raw(legacy), config.appKey)).toBe("old-pass"); // dry-run ไม่เขียน
    expect(await rekeyVault()).toMatchObject({ rekeyed: 1, failed: [] });
    expect(decryptString(await raw(legacy), key)).toBe("old-pass");
    const legacyRaw = await raw(legacy);
    expect(() => decryptString(legacyRaw, config.appKey)).toThrow();
    expect((await api.post(`/api/v1/credentials/${legacy}/reveal`)).body.data.password).toBe("old-pass");
    expect(await rekeyVault()).toMatchObject({ rekeyed: 0 });
    expect(await first("SELECT 1 AS x FROM audit_logs WHERE action = 'vault.rekeyed'")).toBeTruthy();
  });
});

describe("confirm on every view", () => {
  it("reauth_minutes = 0 asks again for every reveal", async () => {
    const admin = await as(await makeUser({ role: "super_admin" }));
    const staff = await as(await makeUser({ is_it_staff: true }));
    expect((await admin.put("/api/v1/settings").send({ secret_guard: { reauth: true, reauth_minutes: 0 } })).body.data.secret_guard.reauth_minutes).toBe(0);
    const id = (await staff.post("/api/v1/credentials").send({ title: "Server", category: "server", password: "p@ss" })).body.data.id;
    expect((await staff.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(428);
    expect((await staff.post("/api/v1/auth/reauth").send({ password: "password" })).status).toBe(204);
    expect((await staff.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(200);
    expect((await staff.post(`/api/v1/credentials/${id}/reveal`)).status).toBe(428);
  });
});
