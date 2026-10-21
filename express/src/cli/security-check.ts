import { closePool, select } from "../db.js";
import { config } from "../config.js";
import { verifyHash } from "../lib/validator.js";
import { passwordPolicy } from "../services/password-policy.js";
import { secretGuard } from "../services/secret-guard.js";
import { decryptVaultWithKey } from "../services/vault-crypto.js";

/**
 * npm run security:check — ตรวจความพร้อมก่อนเปิดระบบออนไลน์ (อ่านอย่างเดียว ไม่แก้ข้อมูล)
 *   FAIL = ต้องแก้ก่อน deploy, WARN = ควรแก้/ตรวจสอบ, OK = ผ่าน — มี FAIL = exit code 1 (ใช้ใน script deploy ได้)
 * บัญชีตัวอย่างจาก seed (@example.com) ใช้รหัสผ่าน SEED_ADMIN_PASSWORD ร่วมกันทุกบัญชี:
 *   สร้างบัญชี super_admin จริง (LOCAL) ก่อน แล้วปิดใช้งาน / เปลี่ยนอีเมล+รหัสผ่านบัญชีตัวอย่างที่หน้า ผู้ใช้งาน
 */
type Level = "OK" | "WARN" | "FAIL";
const results: { level: Level; check: string; detail: string }[] = [];
const report = (level: Level, check: string, detail: string) => results.push({ level, check, detail });

interface UserRow {
  id: number;
  email: string | null;
  role: string;
  type: string;
  password: string | null;
  two_factor_confirmed_at?: string | null;
}

try {
  const users = await select<UserRow>("SELECT * FROM users WHERE is_active = true");

  // 1) บัญชีตัวอย่างจาก seed
  const examples = users.filter((u) => /@example\.com$/i.test(u.email ?? ""));
  if (examples.length) report("WARN", "บัญชีตัวอย่าง (@example.com) ยังเปิดใช้งาน", examples.map((u) => `${u.email} (${u.role})`).join(", "));
  else report("OK", "บัญชีตัวอย่าง (@example.com)", "ไม่มีบัญชีตัวอย่างที่เปิดใช้งาน");

  // 2) บัญชีที่ยังใช้รหัสผ่านตั้งต้นของ seed
  const seedPassword = process.env.SEED_ADMIN_PASSWORD?.replace(/^"(.*)"$/, "$1");
  if (seedPassword) {
    const same = users.filter((u) => u.type === "LOCAL" && u.password && verifyHash(seedPassword, u.password));
    if (same.length) report("FAIL", "ใช้รหัสผ่านตั้งต้นของ seed (SEED_ADMIN_PASSWORD)", same.map((u) => u.email).join(", "));
    else report("OK", "รหัสผ่านตั้งต้นของ seed", "ไม่มีบัญชีที่ใช้รหัสนี้แล้ว");
  } else report("WARN", "รหัสผ่านตั้งต้นของ seed", "ไม่ได้ตั้ง SEED_ADMIN_PASSWORD ใน env — ตรวจไม่ได้ (ตั้งค่าชั่วคราวตอนรันคำสั่งนี้)");

  // 3) ต้องมี super_admin บัญชี LOCAL ที่ไม่ใช่บัญชีตัวอย่าง (ทางสำรองเมื่อ API ต้นทางล่ม)
  const realSuper = users.filter((u) => u.role === "super_admin" && u.type === "LOCAL" && !/@example\.com$/i.test(u.email ?? ""));
  if (realSuper.length) report("OK", "super_admin บัญชี LOCAL จริง", realSuper.map((u) => u.email).join(", "));
  else report("WARN", "super_admin บัญชี LOCAL จริง", "ยังไม่มี — สร้างก่อนปิดบัญชีตัวอย่าง ไม่งั้นจะเข้าระบบไม่ได้");

  // 4) 2FA ของผู้ดูแลระบบ (คอลัมน์มีหลัง migration 2FA)
  if (users.length && "two_factor_confirmed_at" in users[0]) {
    const admins = users.filter((u) => ["super_admin", "admin"].includes(u.role) && u.type === "LOCAL");
    const without = admins.filter((u) => !u.two_factor_confirmed_at);
    if (without.length) report("WARN", "2FA ของผู้ดูแลระบบ (LOCAL)", `ยังไม่เปิด: ${without.map((u) => u.email).join(", ")}`);
    else if (admins.length) report("OK", "2FA ของผู้ดูแลระบบ (LOCAL)", "เปิดครบทุกคน");
    // super_admin ควรมีอย่างน้อย 2 คน (คนละคนจริง) ที่เปิด 2FA — คนหนึ่งไม่อยู่ / โทรศัพท์หาย ยังมีอีกคนเข้าได้ และได้รับแจ้งเตือนเมื่ออีกคน login
    const supers = realSuper.filter((u) => u.two_factor_confirmed_at);
    if (supers.length >= 2) report("OK", "super_admin ที่เปิด 2FA อย่างน้อย 2 คน", supers.map((u) => u.email).join(", "));
    else report("WARN", "super_admin ที่เปิด 2FA อย่างน้อย 2 คน", `มี ${supers.length} คน — แนะนำ 2 คน (คนละคนจริง ไม่ใช้บัญชีร่วม) เก็บ recovery code ไว้ในที่ปลอดภัย`);
  }

  // 5) ค่าการตั้งค่า
  if (process.env.NODE_ENV !== "production") report("WARN", "NODE_ENV", `= ${process.env.NODE_ENV ?? "(ไม่ได้ตั้ง)"} — เครื่องจริงควรเป็น production`);
  else report("OK", "NODE_ENV", "production");
  if (config.db.user === "root") report("FAIL", "ผู้ใช้ฐานข้อมูล", "API ต่อฐานด้วย root — ใช้ผู้ใช้เฉพาะ (it_app)");
  else report("OK", "ผู้ใช้ฐานข้อมูล", config.db.user);
  // ค่าตั้งต้นใน docker-compose.yml เมื่อไม่ได้ตั้ง IT_DB_PASSWORD / IT_DB_ROOT_PASSWORD
  const weakDb = ["change_me_strong_password", "root_change_me", "password", "secret", ""].includes(String(config.db.password ?? ""));
  if (weakDb) report("FAIL", "รหัสผ่านฐานข้อมูล", "ยังเป็นค่าตั้งต้น / ว่าง — ตั้ง IT_DB_PASSWORD และ IT_DB_ROOT_PASSWORD ใน .env ที่โฟลเดอร์หลักให้ยาวและสุ่ม");
  else if (String(config.db.password).length < 16) report("WARN", "รหัสผ่านฐานข้อมูล", "สั้นกว่า 16 ตัวอักษร");
  else report("OK", "รหัสผ่านฐานข้อมูล", "ไม่ใช่ค่าตั้งต้น");
  if (config.tokenTtlMinutes > 24 * 60) report("WARN", "อายุ session", `${config.tokenTtlMinutes} นาที — ควรไม่เกิน 1 วัน`);
  else report("OK", "อายุ session", `${config.tokenTtlMinutes} นาที`);
  if (config.bcryptRounds < 12) report("WARN", "BCRYPT_ROUNDS", `${config.bcryptRounds} — ควร ≥ 12`);
  report("OK", "TRUST_PROXY", `${config.trustProxy} — ต้องตรงกับ reverse proxy ที่เขียนทับ X-Forwarded-For (ดู deploy/README.md)`);

  // 6) การป้องกันตอนเปิดดูข้อมูลลับ
  const guard = await secretGuard();
  if (!guard.reauth) report("WARN", "ยืนยันตัวตนซ้ำก่อนเปิดดูข้อมูลลับ", "ปิดอยู่ — เปิดที่หน้า ตั้งค่าระบบ");
  else report("OK", "ยืนยันตัวตนซ้ำก่อนเปิดดูข้อมูลลับ", `เปิด (${guard.reauth_method})`);
  // กุญแจคลังบัญชีแยกจาก APP_KEY (services/vault-crypto.ts) + ข้อมูลเดิมที่ยังเข้ารหัสด้วย APP_KEY
  if (!config.vaultKey) report("WARN", "กุญแจคลังบัญชี (VAULT_KEY)", "ยังใช้ APP_KEY — สร้างด้วย npm run vault:keygen แล้วตั้ง VAULT_KEY_FILE (เก็บนอกโฟลเดอร์ระบบ / นอกไฟล์สำรอง) และรัน npm run vault:rekey");
  else if (config.vaultKey.equals(config.appKey)) report("FAIL", "กุญแจคลังบัญชี (VAULT_KEY)", "ค่าเดียวกับ APP_KEY — ต้องเป็นกุญแจคนละตัว");
  else {
    const rows = await select<{ password: string | null; secret_notes: string | null }>("SELECT password, secret_notes FROM credentials WHERE password IS NOT NULL OR secret_notes IS NOT NULL");
    let legacy = 0;
    for (const r of rows) {
      for (const v of [r.password, r.secret_notes]) {
        if (v === null) continue;
        try {
          if (decryptVaultWithKey(v).key === "app_key") legacy++;
        } catch {
          legacy++;
        }
      }
    }
    if (legacy) report("WARN", "กุญแจคลังบัญชี (VAULT_KEY)", `ยังมี ${legacy} ค่าที่เข้ารหัสด้วย APP_KEY — รัน npm run vault:rekey`);
    else report("OK", "กุญแจคลังบัญชี (VAULT_KEY)", `แยกจาก APP_KEY (${config.vaultKeySource === "file" ? "ไฟล์" : "env"})`);
  }
  if (!guard.ip_restrict) report("WARN", "จำกัด IP ตอนเปิดดูข้อมูลลับ", "ปิดอยู่ — แนะนำจำกัดเฉพาะ IP สำนักงาน / VPN");
  else report("OK", "จำกัด IP ตอนเปิดดูข้อมูลลับ", guard.allowed_ips.join(", "));

  const policy = await passwordPolicy();
  if (policy.lockout_attempts <= 0) report("WARN", "ล็อกบัญชีเมื่อ login ผิด", "ปิดอยู่ — เปิดที่หน้า ตั้งค่าระบบ → นโยบายรหัสผ่าน");
  else report("OK", "ล็อกบัญชีเมื่อ login ผิด", `ผิด ${policy.lockout_attempts} ครั้ง = ล็อก ${policy.lockout_minutes} นาที`);
  if (policy.expiry_days <= 0) report("WARN", "บังคับเปลี่ยนรหัสผ่าน", "ปิดอยู่ — แนะนำทุก 90–180 วัน (หน้า ตั้งค่าระบบ → นโยบายรหัสผ่าน)");
  else report("OK", "บังคับเปลี่ยนรหัสผ่าน", `ทุก ${policy.expiry_days} วัน`);
} finally {
  await closePool();
}

const icon: Record<Level, string> = { OK: "✔", WARN: "!", FAIL: "✖" };
for (const r of results) console.log(`${icon[r.level]} [${r.level}] ${r.check}: ${r.detail}`);
const fails = results.filter((r) => r.level === "FAIL").length;
console.log(`\nสรุป: FAIL ${fails} · WARN ${results.filter((r) => r.level === "WARN").length} · OK ${results.filter((r) => r.level === "OK").length}`);
process.exitCode = fails ? 1 : 0;
