import { rm } from "node:fs/promises";
import { afterAll, beforeEach } from "vitest";
import { config } from "../src/config.js";
import { closePool, exec, select, transaction } from "../src/db.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { sentMail } from "../src/services/mail.js";
import { ensurePermissions } from "../src/services/permissions.js";

let tables: string[] | null = null;

/** ล้างข้อมูลทุกตารางก่อนแต่ละเทสต์ (เหมือน RefreshDatabase) — ไม่ล้างประวัติ migration ของ Prisma */
beforeEach(async () => {
  if (!config.db.database.endsWith("_test")) throw new Error("Tests must use the *_test database");
  // ล้างทุกตาราง + รีเซ็ตเลข id — ใช้ connection เดียวกัน (transaction) เพราะ FOREIGN_KEY_CHECKS เป็นค่าของ session
  // TRUNCATE ช้าบน MySQL — ล้างเฉพาะตารางที่มีข้อมูล (หาด้วย query เดียว)
  tables ??= (
    await select<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'",
    )
  ).map((t) => t.name);
  const dirty = (await select<{ name: string }>(tables.map((t) => `(SELECT '${t}' AS name FROM "${t}" LIMIT 1)`).join(" UNION ALL "))).map((r) => r.name);
  if (dirty.length) {
    await transaction(async () => {
      await exec("SET FOREIGN_KEY_CHECKS = 0");
      try {
        for (const t of dirty) await exec(`TRUNCATE TABLE "${t}"`);
      } finally {
        await exec("SET FOREIGN_KEY_CHECKS = 1");
      }
    });
  }
  await rm(config.filesRoot, { recursive: true, force: true });
  resetRateLimits();
  await ensurePermissions(); // สิทธิ์ตั้งต้น (เหมือนตอน start server)
  sentMail.length = 0;
});

afterAll(async () => {
  await closePool();
});
