/**
 * ย้ายข้อมูลจาก PostgreSQL (ระบบเดิม) → MySQL — ใช้ครั้งเดียวตอนเปลี่ยนฐานข้อมูล (อ่านต้นทางอย่างเดียว ไม่แก้ไข)
 *
 *   1) สร้างตารางใน MySQL ก่อน:  npx prisma migrate deploy
 *   2) เปิดฐานเดิม:  docker compose --profile legacy-postgres up -d postgres
 *   3) LEGACY_POSTGRES_URL=postgresql://it_app:รหัส@127.0.0.1:5433/it_system  npm run db:import-postgres
 *
 * - ปลายทางต้องว่าง (กันรันซ้ำแล้วข้อมูลซ้อน) — เพิ่ม --truncate เพื่อล้างปลายทางก่อน
 * - ไม่ย้ายข้อมูลชั่วคราว (cache, sessions, jobs) และประวัติ migration ของ Prisma
 * - ค่าเป็นไปตามคอลัมน์ปลายทาง: JSON → ข้อความ JSON, วันที่/เวลาคงเป็นข้อความตามที่เก็บ (UTC)
 * - ปิด FOREIGN_KEY_CHECKS ระหว่างย้าย (ลำดับตาราง/คอลัมน์ที่อ้างถึงตัวเองไม่มีผล) — AUTO_INCREMENT ต่อจาก id สูงสุดให้เอง
 */
import pg from "pg";
import { closePool, exec, first, select, transaction } from "../src/db.js";

const SKIP = new Set(["_prisma_migrations", "cache", "cache_locks", "sessions", "jobs", "job_batches", "failed_jobs"]);
const BATCH = 500;

const url = process.env.LEGACY_POSTGRES_URL;
if (!url) {
  console.error("Set LEGACY_POSTGRES_URL, e.g. postgresql://it_app:password@127.0.0.1:5433/it_system");
  process.exit(1);
}
const truncate = process.argv.includes("--truncate");

// วันที่/เวลาให้คงเป็นข้อความ "YYYY-MM-DD HH:MM:SS" (pg แปลงเป็น Date ตามเขตเวลาเครื่องโดยค่าตั้งต้น)
const keep = (v: string) => v;
const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === pg.types.builtins.DATE || oid === pg.types.builtins.TIMESTAMP || oid === pg.types.builtins.TIMESTAMPTZ) return keep;
    return pg.types.getTypeParser(oid, format as "text");
  },
} as pg.CustomTypesConfig;

const legacy = new pg.Client({ connectionString: url, types });
await legacy.connect();
await legacy.query("SET timezone = 'UTC'");

try {
  const columns = await select<{ table_name: string; column_name: string; data_type: string }>(
    "SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type FROM information_schema.columns WHERE table_schema = DATABASE()",
  );
  const typeOf = (table: string, column: string) => columns.find((c) => c.table_name === table && c.column_name === column)?.data_type;
  const tables = [...new Set(columns.map((c) => c.table_name))].filter((t) => !SKIP.has(t)).sort();

  const convert = (table: string, column: string, value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (typeOf(table, column) === "json") return typeof value === "string" ? value : JSON.stringify(value);
    return value;
  };

  await transaction(async () => {
    await exec("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of tables) {
        if (truncate) await exec(`TRUNCATE TABLE "${table}"`);
        else if (await first(`SELECT 1 FROM "${table}" LIMIT 1`)) throw new Error(`Target table "${table}" is not empty — use --truncate to replace its data`);
      }

      for (const table of tables) {
        const { rows } = await legacy.query(`SELECT * FROM "${table}"`);
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const cols = Object.keys(chunk[0]).filter((c) => typeOf(table, c) !== undefined);
          const values: unknown[] = [];
          const tuples = chunk.map((row) => {
            values.push(...cols.map((c) => convert(table, c, row[c])));
            return `(${cols.map(() => "?").join(", ")})`;
          });
          await exec(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`, values);
        }
        console.log(`${table.padEnd(26)} ${rows.length} rows`);
      }
    } finally {
      await exec("SET FOREIGN_KEY_CHECKS = 1");
    }
  });

  // ตรวจจำนวนแถวต้นทาง = ปลายทาง
  let ok = true;
  for (const table of tables) {
    const src = Number((await legacy.query(`SELECT COUNT(*) AS n FROM "${table}"`)).rows[0].n);
    const dst = Number((await first<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`))?.n);
    if (src !== dst) {
      ok = false;
      console.error(`MISMATCH ${table}: postgres=${src} mysql=${dst}`);
    }
  }
  console.log(ok ? "\nAll row counts match." : "\nRow count mismatch — see above.");
  if (!ok) process.exitCode = 1;
} finally {
  await legacy.end();
  await closePool();
}
