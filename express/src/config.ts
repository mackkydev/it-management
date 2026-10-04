import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * โหลดค่าจาก express/.env
 * process.loadEnvFile ไม่เขียนทับค่าที่มีอยู่แล้ว → env ของ container/เซิร์ฟเวอร์มีลำดับสูงสุด
 * SKIP_ENV_FILES=1 = ไม่อ่านไฟล์เลย (ใช้ env ของระบบอย่างเดียว)
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = path.join(root, ".env");
if (!process.env.SKIP_ENV_FILES && existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const env = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v === "null" ? fallback : v.replace(/^"(.*)"$/, "$1");
};

function appKey(): Buffer {
  const raw = env("APP_KEY");
  const key = raw.startsWith("base64:") ? Buffer.from(raw.slice(7), "base64") : Buffer.from(raw, "utf8");
  if (key.length !== 32) throw new Error("APP_KEY must be a 32-byte key (base64:...) — use the existing value if there is encrypted data");
  return key;
}

export const config = {
  appName: env("APP_NAME", "IT-SYSTEM"),
  port: Number(env("PORT", "8020")),
  appKey: appKey(),
  defaultLocale: env("APP_LOCALE", "th") as "th" | "en",
  db: dbConfig(),
  /** อายุ token ที่ออกตอน login (นาที) — ค่าเริ่มต้น 12 ชั่วโมง */
  tokenTtlMinutes: Number(env("EAM_TOKEN_TTL_MINUTES", String(60 * 12))),
  /** API User: ไม่มีการใช้งานเกินกี่นาทีแล้วต้อง login ใหม่ (session ของ API User เท่านั้น — ผู้ใช้ LOCAL ทำงานเหมือนเดิม) */
  apiSessionIdleMinutes: Number(env("API_SESSION_IDLE_MINUTES", "30")),
  /** timezone ของผู้ใช้ — ใช้ตัดสินว่า "วันนี้" คือวันไหนตอนตรวจวันที่ห้ามเป็นอนาคต (ฐานข้อมูลยังเก็บ UTC) */
  localTimezone: env("EAM_LOCAL_TIMEZONE", "Asia/Bangkok"),
  frontendUrls: env("FRONTEND_URLS", "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
  /** โฟลเดอร์ไฟล์แนบ/ลายเซ็น/ไฟล์ license (private — เปิดผ่าน endpoint ที่ตรวจสิทธิ์เท่านั้น) */
  filesRoot: path.resolve(root, env("FILES_ROOT", "../storage/private")),
  bcryptRounds: Number(env("BCRYPT_ROUNDS", "12")),
  /** prefix ของ cache ใน Laravel (ใช้ล้าง cache ที่ Laravel อ่าน เมื่อ Express แก้ข้อมูล) */
  laravelCachePrefix: env("CACHE_PREFIX", `${slug(env("APP_NAME", "laravel"))}-cache-`),
  /** ให้ IP จริงจาก X-Forwarded-For (เช่น Next.js / reverse proxy ที่เชื่อถือได้) */
  trustProxy: env("TRUST_PROXY", "loopback, linklocal, uniquelocal"),
  mail: {
    mailer: env("MAIL_MAILER", "log"),
    host: env("MAIL_HOST", "127.0.0.1"),
    port: Number(env("MAIL_PORT", "587")),
    scheme: env("MAIL_SCHEME"),
    username: env("MAIL_USERNAME"),
    password: env("MAIL_PASSWORD"),
    fromAddress: env("MAIL_FROM_ADDRESS", "it-system@example.com"),
    fromName: env("MAIL_FROM_NAME", "IT-SYSTEM"),
  },
  scheduler: {
    enabled: env("SCHEDULER_ENABLED", "false") === "true",
    time: env("SCHEDULE_NOTIFY_AT", "08:00"),
    timezone: env("SCHEDULE_TIMEZONE", "Asia/Bangkok"),
  },
};

export function dbConfig() {
  return {
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", "5432")),
    database: env("DB_DATABASE", "it_system"),
    user: env("DB_USERNAME", "it_app"),
    password: env("DB_PASSWORD"),
  };
}

/** เหมือน Str::slug ของ Laravel สำหรับชื่อแอป (ASCII) */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
