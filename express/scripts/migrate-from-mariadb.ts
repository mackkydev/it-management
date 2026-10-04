/**
 * ย้ายข้อมูลจาก MariaDB (ระบบเดิม) → PostgreSQL — ใช้ครั้งเดียวตอนเปลี่ยนฐานข้อมูล
 *
 *   1) สร้างตารางใน PostgreSQL ก่อน:  npx prisma migrate deploy
 *   2) LEGACY_MARIADB_URL=mysql://it_app:รหัส@127.0.0.1:3307/it_system  npx tsx scripts/migrate-from-mariadb.ts
 *
 * - ปลายทางต้องว่าง (กันรันซ้ำแล้วข้อมูลซ้อน) — เพิ่ม --truncate เพื่อล้างปลายทางก่อน
 * - ไม่ย้ายข้อมูลชั่วคราวของ Laravel (cache, sessions, jobs)
 * - แปลงชนิดตามคอลัมน์ปลายทาง: tinyint(1) → boolean, ข้อความ JSON → jsonb
 * - users.supervisor_id / locations.parent_id อ้างถึงตารางตัวเอง → ใส่ทีหลัง (2 รอบ)
 */
import mysql from "mysql2/promise";
import { closePool, exec, first, select, transaction } from "../src/db.js";

const TABLES = [
  "branches", "users", "locations", "assets", "asset_movements", "app_settings",
  "credentials", "credential_access_logs", "contracts",
  "it_tickets", "it_ticket_parts", "it_ticket_attachments", "it_ticket_events",
  "notifications", "personal_access_tokens", "migrations", "password_reset_tokens",
];
/** คอลัมน์ที่อ้างถึงตารางตัวเอง — ใส่ค่าหลังจากทุกแถวมีแล้ว */
const SELF_REFERENCE: Record<string, string> = { users: "supervisor_id", locations: "parent_id" };
const BATCH = 500;

const url = process.env.LEGACY_MARIADB_URL;
if (!url) {
  console.error("Set LEGACY_MARIADB_URL, e.g. mysql://it_app:password@127.0.0.1:3307/it_system");
  process.exit(1);
}
const truncate = process.argv.includes("--truncate");

const legacy = await mysql.createConnection({ uri: url, dateStrings: true, supportBigNumbers: true, charset: "utf8mb4_unicode_ci" });

try {
  // ชนิดคอลัมน์ปลายทาง (ใช้แปลงค่า)
  const columns = await select<{ table_name: string; column_name: string; data_type: string }>(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'",
  );
  const typeOf = (table: string, column: string) => columns.find((c) => c.table_name === table && c.column_name === column)?.data_type;

  const convert = (table: string, column: string, value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    switch (typeOf(table, column)) {
      case "boolean":
        return Boolean(Number(value));
      case "jsonb":
      case "json":
        return typeof value === "string" ? value : JSON.stringify(value);
      default:
        return Buffer.isBuffer(value) ? value.toString("utf8") : value;
    }
  };

  await transaction(async () => {
    if (truncate) {
      await exec(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    } else {
      for (const table of TABLES) {
        if (await first(`SELECT 1 FROM "${table}" LIMIT 1`)) throw new Error(`Target table "${table}" is not empty — use --truncate to replace its data`);
      }
    }

    for (const table of TABLES) {
      const [rows] = await legacy.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${table}\``);
      const selfRef = SELF_REFERENCE[table];
      const later: Array<[unknown, unknown]> = [];

      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const cols = Object.keys(chunk[0]);
        const values: unknown[] = [];
        const tuples = chunk.map((row) => {
          const vals = cols.map((c) => {
            if (c === selfRef && row[c] !== null) {
              later.push([row.id, row[c]]);
              return null;
            }
            return convert(table, c, row[c]);
          });
          values.push(...vals);
          return `(${cols.map((c) => (["jsonb", "json"].includes(typeOf(table, c) ?? "") ? "?::jsonb" : "?")).join(", ")})`;
        });
        await exec(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`, values);
      }
      for (const [id, ref] of later) await exec(`UPDATE "${table}" SET "${selfRef}" = ? WHERE id = ?`, [ref, id]);

      // ให้ id ถัดไปต่อจากค่าสูงสุด (เหมือน AUTO_INCREMENT)
      if (typeOf(table, "id") === "bigint" || typeOf(table, "id") === "integer") {
        await exec(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`);
      }
      console.log(`${table.padEnd(24)} ${rows.length} rows`);
    }
  });

  // ตรวจจำนวนแถวต้นทาง = ปลายทาง
  let ok = true;
  for (const table of TABLES) {
    const [[src]] = await legacy.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const dst = await first<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`);
    if (Number(src.n) !== Number(dst?.n)) {
      ok = false;
      console.error(`MISMATCH ${table}: mariadb=${src.n} postgres=${dst?.n}`);
    }
  }
  console.log(ok ? "\nAll row counts match." : "\nRow count mismatch — see above.");
  if (!ok) process.exitCode = 1;
} finally {
  await legacy.end();
  await closePool();
}
