import { rm } from "node:fs/promises";
import { afterAll, beforeEach } from "vitest";
import { config } from "../src/config.js";
import { closePool, exec, select } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { sentMail } from "../src/services/mail.js";

/** ล้างข้อมูลทุกตารางก่อนแต่ละเทสต์ (เหมือน RefreshDatabase) — ไม่ล้างประวัติ migration ของ Prisma */
beforeEach(async () => {
  if (!config.db.database.endsWith("_test")) throw new Error("Tests must use the *_test database");
  const tables = await select<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  // คำสั่งเดียว: ล้างทุกตาราง + รีเซ็ตเลข id (ไม่ต้องปิด foreign key เหมือน MariaDB)
  await exec(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await rm(config.filesRoot, { recursive: true, force: true });
  resetRateLimits();
  sentMail.length = 0;
});

afterAll(async () => {
  await closePool();
});
