import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { first, scalar } from "../src/db.js";
import { verifyHash } from "../src/lib/validator.js";
import { guest } from "./helpers.js";

/** ฐานใหม่ที่สร้างจาก Prisma migration + seed ใช้งานได้ทันที (ไม่ต้องมี PHP/Laravel) */
describe("prisma seed", () => {
  const seed = () =>
    execSync("npx tsx src/cli/seed.ts", { env: { ...process.env, DB_DATABASE: "it_system_test", SEED_ADMIN_PASSWORD: "Seed-Pass-1" }, stdio: "pipe" });

  it("seeds branches and users, is re-runnable, and the admin can log in", async () => {
    seed();
    seed(); // รันซ้ำได้ ไม่สร้างซ้ำ

    expect(Number(await scalar("SELECT COUNT(*) FROM branches"))).toBe(10);
    expect(Number(await scalar("SELECT COUNT(*) FROM users"))).toBe(6);
    const staff = await first<{ supervisor_id: number; branch_id: number }>("SELECT supervisor_id, branch_id FROM users WHERE email = 'staff@example.com'");
    const chief = await first<{ id: number }>("SELECT id FROM users WHERE email = 'chief@example.com'");
    expect(staff!.supervisor_id).toBe(chief!.id);

    const admin = await first<{ password: string; role: string }>("SELECT password, role FROM users WHERE email = 'admin@example.com'");
    expect(admin!.role).toBe("super_admin");
    expect(verifyHash("Seed-Pass-1", admin!.password)).toBe(true);

    const login = await guest().post("/api/v1/auth/login").send({ email: "admin@example.com", password: "Seed-Pass-1", device_name: "seed-test" });
    expect(login.status).toBe(200);
    expect(login.body.user.branch_id).toBeTypeOf("number");
  });
});
