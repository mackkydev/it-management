import { describe, expect, it } from "vitest";
import { scalar, select } from "../src/db.js";
import { rolesAbove, ROLES } from "../src/models/user.js";
import { usersWithPermissions } from "../src/services/permissions.js";
import { as, makeAsset, makeBranch, makeUser } from "./helpers.js";

/** ระดับผู้ใช้ 6 ระดับ + กลุ่มงานตอนสร้างผู้ใช้ + เมนูเฉพาะสาขา */
describe("user levels", () => {
  it("orders the levels: super admin > admin > executive > division manager > department manager > staff", async () => {
    expect(ROLES).toEqual(["super_admin", "admin", "executive", "division_manager", "manager", "viewer", "auditor"]);
    expect(rolesAbove("manager")).toEqual(["super_admin", "admin", "executive", "division_manager"]);
    expect(rolesAbove("division_manager")).toEqual(["super_admin", "admin", "executive"]);
    const api = await as(await makeUser({ role: "super_admin" }));
    const groups = (await api.get("/api/v1/permissions")).body.groups as { key: string; name_th: string }[];
    expect(groups.slice(0, 7).map((g) => g.key)).toEqual(ROLES);
    expect(groups.find((g) => g.key === "manager")?.name_th).toBe("ผู้จัดการแผนก");
  });

  it("executive starts with the division manager's permissions and can be assigned by someone who holds them", async () => {
    const perms = async (role: string) => (await select<{ key: string }>('SELECT p."key" FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role = ?', [role])).map((r) => r.key).sort();
    expect(await perms("executive")).toEqual(await perms("division_manager"));
    const root = await as(await makeUser({ role: "super_admin" }));
    const made = await root.post("/api/v1/users").send({ name: "ผู้บริหาร", email: "exec@example.com", role: "executive", password: "Pass-1234", password_confirmation: "Pass-1234" });
    expect(made.status).toBe(201);
    expect(made.body.data.role).toBe("executive");
  });

  it("creating a user can add custom groups — same rules as the user permission page, recorded in the audit log", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const key = (await root.post("/api/v1/permission-groups").send({ name_th: "ฝ่ายบุคคล", name_en: "HR", keys: [] })).body.data.key as string;
    await root.put(`/api/v1/permissions/roles/${key}`).send({ keys: ["holidays.manage"] });
    const body = (n: string, groups: string[]) => ({ name: n, email: `${n}@example.com`, role: "viewer", password: "Pass-1234", password_confirmation: "Pass-1234", groups });

    const made = await root.post("/api/v1/users").send(body("hr1", [key]));
    expect(made.status).toBe(201);
    expect(Number(await scalar("SELECT COUNT(*) FROM user_groups WHERE user_id = ? AND group_key = ?", [made.body.data.id, key]))).toBe(1);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'user.permissions_updated' AND subject_id = ?", [String(made.body.data.id)]))).toBe(1);
    // กลุ่มตามตำแหน่ง / กลุ่มที่ไม่มีจริง ใช้ไม่ได้
    expect((await root.post("/api/v1/users").send(body("hr2", ["admin"]))).status).toBe(422);
    expect((await root.post("/api/v1/users").send(body("hr3", ["nope"]))).status).toBe(422);
    // ผู้ไม่มีสิทธิ์ข้อนั้นมอบกลุ่มที่มีสิทธิ์นั้นไม่ได้
    const creator = await makeUser({ role: "viewer" });
    await root.put(`/api/v1/users/${creator.id}/permissions`).send({ overrides: { "users.create": "allow" } });
    expect((await (await as(creator)).post("/api/v1/users").send(body("hr4", [key]))).status).toBe(422);
  });
});

describe("auditor (read-only on every page)", () => {
  it("can open everything but changes nothing, and cannot reveal secrets", async () => {
    const auditorUser = await makeUser({ role: "auditor" });
    const auditor = await as(auditorUser);
    const pc = await makeAsset({ asset_tag: "PC-AUD", category: "COMPUTER" });
    for (const path of ["/api/v1/assets", "/api/v1/users", "/api/v1/audit-logs", "/api/v1/contracts", "/api/v1/credentials", "/api/v1/settings", "/api/v1/permissions", "/api/v1/movements", "/api/v1/repairs"]) {
      const res = await auditor.get(path);
      expect(res.status === 200 || res.status === 404, path).toBe(true);
      expect(res.status, path).not.toBe(403);
    }
    expect((await auditor.get(`/api/v1/assets/${pc.uuid}`)).status).toBe(200);
    const me = (await auditor.get("/api/v1/auth/me")).body.data;
    expect(me.permissions).toContain("assets.view_all");
    expect(me.permissions).not.toContain("assets.license_key");

    const blocked = await auditor.post("/api/v1/assets").send({ asset_tag: "NO", name: "x", category: "IT" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("read_only");
    expect((await auditor.patch(`/api/v1/assets/${pc.uuid}`).send({ name: "แก้" })).status).toBe(403);
    expect((await auditor.delete(`/api/v1/assets/${pc.uuid}`)).status).toBe(403);
    expect((await auditor.post(`/api/v1/assets/${pc.uuid}/license-key`)).status).toBe(403);
    expect((await auditor.post("/api/v1/tickets").send({ type: "install", details: "x" })).status).toBe(403);
    expect((await auditor.get("/api/v1/menu-badges")).body.data).toEqual({});
    // เรื่องของตัวเองยังทำได้
    expect((await auditor.post("/api/v1/auth/logout")).status).not.toBe(403);
  });

  it("is never counted as an approver or notification recipient, and only super admins can assign it", async () => {
    const auditorUser = await makeUser({ role: "auditor" });
    const staff = await usersWithPermissions(["tickets.approve_any"]);
    expect(staff.map((u) => u.id)).not.toContain(auditorUser.id);
    expect(rolesAbove("viewer")).not.toContain("auditor");

    const root = await as(await makeUser({ role: "super_admin" }));
    const admin = await as(await makeUser({ role: "admin" }));
    const target = await makeUser();
    expect((await admin.put(`/api/v1/users/${target.id}/permissions`).send({ role: "auditor" })).status).toBe(422);
    expect((await root.put(`/api/v1/users/${target.id}/permissions`).send({ role: "auditor" })).status).toBe(200);
    // ตารางสิทธิ์ตายตัว + มอบเป็นกลุ่มเพิ่มไม่ได้
    expect((await root.put("/api/v1/permissions/roles/auditor").send({ keys: [] })).status).toBe(422);
    const other = await makeUser();
    expect((await root.put(`/api/v1/users/${other.id}/permissions`).send({ groups: [{ key: "auditor", expires_on: null }] })).status).toBe(422);
  });
});

describe("menus per branch", () => {
  it("saves menu_branches for access.manage only, and rejects unknown branches", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const branch = await makeBranch({ code: "SRB9", name: "สระบุรี" });
    const saved = await root.put("/api/v1/ui-config").send({ menu_branches: { "/vehicles": [branch, branch], "/zoom": [] } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.menu_branches).toEqual({ "/vehicles": [branch] });
    expect((await root.get("/api/v1/ui-config")).body.data.menu_branches).toEqual({ "/vehicles": [branch] });
    expect((await root.put("/api/v1/ui-config").send({ menu_branches: { "/vehicles": [999999] } })).status).toBe(422);
    const admin = await as(await makeUser({ role: "admin" }));
    expect((await admin.put("/api/v1/ui-config").send({ menu_branches: { "/vehicles": [] } })).status).toBe(403);
    // access.groups ยังแก้การซ่อนเมนูของกลุ่มที่ต่ำกว่าได้ตามเดิม
    expect((await admin.put("/api/v1/ui-config").send({ ui_permissions: { "/zoom": ["viewer"] } })).status).toBe(200);
    expect(Number(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'settings.ui_config_updated'"))).toBeGreaterThan(0);
  });
});

describe("users form fields", () => {
  it("job title is optional free text; the auditor group can be renamed by access.manage only", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const made = await root.post("/api/v1/users").send({ name: "มีตำแหน่ง", email: "title@example.com", role: "viewer", job_title: "นักบัญชีอาวุโส", password: "Pass-1234", password_confirmation: "Pass-1234" });
    expect(made.body.data.job_title).toBe("นักบัญชีอาวุโส");
    const cleared = await root.patch(`/api/v1/users/${made.body.data.id}`).send({ job_title: null });
    expect(cleared.body.data.job_title).toBeNull();

    const renamed = await root.put("/api/v1/permission-groups/auditor").send({ name_th: "ผู้สอบบัญชี", name_en: "External auditor" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name_th).toBe("ผู้สอบบัญชี");
    expect((await (await as(await makeUser({ role: "admin" }))).put("/api/v1/permission-groups/auditor").send({ name_th: "x", name_en: "y" })).status).toBe(422);
    // ตารางสิทธิ์ยังแก้ไม่ได้
    expect((await root.put("/api/v1/permissions/roles/auditor").send({ keys: [] })).status).toBe(422);
  });
});

describe("IT manager from the user form", () => {
  it("can be set and cleared; other fields do not touch it; the change is audited", async () => {
    const root = await as(await makeUser({ role: "super_admin" }));
    const made = await root.post("/api/v1/users").send({ name: "หัวหน้า", email: "head@example.com", role: "admin", is_it_head: true, password: "Pass-1234", password_confirmation: "Pass-1234" });
    expect(made.body.data.is_it_head).toBe(true);
    const id = made.body.data.id;
    expect((await root.patch(`/api/v1/users/${id}`).send({ job_title: "ผู้จัดการ" })).body.data.is_it_head).toBe(true);
    expect((await root.patch(`/api/v1/users/${id}`).send({ is_it_head: false })).body.data.is_it_head).toBe(false);
    expect(await scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'user.access_updated' AND subject_id = ?", [String(id)])).toBeGreaterThan(0);
  });
});
