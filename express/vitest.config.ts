import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * เทสต์ใช้ฐาน it_system_test (สร้างใหม่จาก Prisma migrations ทุกครั้งที่รัน) — ไม่แตะข้อมูลจริง
 * ค่า env ที่ตั้งที่นี่มีลำดับเหนือ .env (loadEnvFile ไม่เขียนทับ)
 */
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DB_DATABASE: "it_system_test",
      FILES_ROOT: path.join(tmpdir(), "it-system-express-test-files"),
      BCRYPT_ROUNDS: "4",
      SCHEDULER_ENABLED: "false",
      MAIL_MAILER: "array",
    },
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
