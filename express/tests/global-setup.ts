import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * สร้างฐาน it_system_test ใหม่จาก Prisma migrations ทุกครั้งที่รันเทสต์
 * (ลบ schema public ทั้งหมด → `prisma migrate deploy`) — พิสูจน์ว่า migration สร้างฐานที่ API ใช้งานได้จริง
 * ป้องกันพลาด: ยอมรันเฉพาะฐานที่ชื่อลงท้าย _test
 */
export default async function setup() {
  // globalSetup ไม่ได้ env จาก test.env — ตั้งชื่อฐานเทสต์เองก่อนโหลดไฟล์ (loadEnvFile ไม่เขียนทับค่าที่มีอยู่)
  process.env.DB_DATABASE = "it_system_test";
  const root = fileURLToPath(new URL("..", import.meta.url));
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const target = process.env.DB_DATABASE;
  if (!target.endsWith("_test")) throw new Error(`Refusing to run tests against non-test database "${target}"`);

  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: target,
  });
  await client.connect();
  try {
    // it_app เป็นเจ้าของ schema public ของฐานเทสต์ (docker/postgres/init.sh) — ลบตาราง/extension ทั้งหมดได้
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", { cwd: root, env: { ...process.env, DB_DATABASE: target }, stdio: "pipe" });
}
