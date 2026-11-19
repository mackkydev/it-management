import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma = เจ้าของโครงสร้างฐานข้อมูล (migration) ของ IT-SYSTEM
 * - API เรียกฐานข้อมูลผ่าน mysql2 / pg (src/db.ts) — Prisma ใช้จัดการ schema/migration เท่านั้น
 * - เลือกฐานด้วย DB_CLIENT: mysql (ค่าตั้งต้น — prisma/schema.prisma + prisma/migrations)
 *   / postgres (PostgreSQL 18 — prisma/postgres/schema.prisma + prisma/postgres/migrations)
 * - URL ประกอบจาก DB_* ใน express/.env (หรือ env ของเซิร์ฟเวอร์) ไม่ต้องตั้ง DATABASE_URL แยก
 */
const envFile = path.join(import.meta.dirname, ".env");
if (!process.env.SKIP_ENV_FILES && existsSync(envFile)) process.loadEnvFile(envFile);

const v = (key: string, fallback = "") => (process.env[key] ?? fallback).replace(/^"(.*)"$/, "$1");
const postgres = /^(postgres|postgresql|pg)$/i.test(v("DB_CLIENT", "mysql"));
const url = (database: string) =>
  `${postgres ? "postgresql" : "mysql"}://${encodeURIComponent(v("DB_USERNAME", "it_app"))}:${encodeURIComponent(v("DB_PASSWORD"))}@${v("DB_HOST", "127.0.0.1")}:${v("DB_PORT", postgres ? "5432" : "3306")}/${encodeURIComponent(database)}`;

const production = process.env.NODE_ENV === "production";
const dir = postgres ? "prisma/postgres" : "prisma";

export default defineConfig({
  schema: `${dir}/schema.prisma`,
  migrations: {
    path: `${dir}/migrations`,
    // ข้อมูลตั้งต้น (สาขา + ผู้ดูแลระบบ) — รันซ้ำได้
    seed: production ? "node dist/cli/seed.js" : "tsx src/cli/seed.ts",
  },
  datasource: {
    url: url(v("DB_DATABASE", "it_system")),
    // ฐานชั่วคราวของ `prisma migrate dev` (ไม่ใช้ใน production)
    ...(production ? {} : { shadowDatabaseUrl: url(v("DB_SHADOW_DATABASE", "it_system_shadow")) }),
  },
});
