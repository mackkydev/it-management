/**
 * คัดลอกข้อมูลทั้งหมดจาก MySQL → PostgreSQL 18 (ไว้เปรียบเทียบสองฐานด้วยข้อมูลจริง) — อ่านต้นทางอย่างเดียว ไม่แก้ไข MySQL
 *
 *   1) เปิด PostgreSQL:  docker compose --profile postgres up -d pgsql
 *   2) สร้างตาราง:      DB_CLIENT=postgres DB_PORT=5434 npx prisma migrate deploy   (ใน express/)
 *   3) คัดลอก:          DB_CLIENT=postgres DB_PORT=5434 SOURCE_MYSQL_URL=mysql://it_app:รหัส@127.0.0.1:3308/it_system npm run db:copy-to-postgres
 *
 * - ปลายทาง (DB_* + DB_CLIENT=postgres) ต้องว่าง — เพิ่ม --truncate เพื่อล้างปลายทางก่อน
 * - ไม่คัดลอกข้อมูลชั่วคราว (cache, sessions, jobs), ประวัติ migration และคอลัมน์ GENERATED (คำนวณใหม่เอง)
 * - ปิด foreign key ระหว่างคัดลอกด้วยการถอดแล้วใส่กลับ (it_app เป็นเจ้าของตาราง ไม่ต้องเป็น superuser) — ข้อมูลไม่ตรง FK = ใส่กลับไม่ผ่านและยกเลิกทั้งหมด
 * - id อัตโนมัติ (sequence) ต่อจาก id สูงสุดให้เอง
 * - ไฟล์แนบ (storage/private) ใช้ร่วมกันได้เลย — path ในฐานเหมือนกัน
 */
import mysql from "mysql2/promise";
import { closePool, exec, first, insert, isPostgres, select, transaction } from "../src/db.js";

const SKIP = new Set(["_prisma_migrations", "cache", "cache_locks", "sessions", "jobs", "job_batches", "failed_jobs"]);
const BATCH = 500;

if (!isPostgres) {
  console.error("Target must be PostgreSQL — run with DB_CLIENT=postgres (and DB_HOST / DB_PORT of the PostgreSQL server)");
  process.exit(1);
}
const url = process.env.SOURCE_MYSQL_URL;
if (!url) {
  console.error("Set SOURCE_MYSQL_URL, e.g. mysql://it_app:password@127.0.0.1:3308/it_system");
  process.exit(1);
}
const truncate = process.argv.includes("--truncate");

const source = await mysql.createConnection({
  uri: url,
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: false,
  timezone: "Z",
  typeCast(field, next) {
    if (field.type === "TINY" && field.length === 1) {
      const v = field.string();
      return v === null ? null : v === "1";
    }
    return next();
  },
});
await source.query("SET time_zone = '+00:00'");

try {
  const columns = await select<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND is_generated = 'NEVER' ORDER BY table_name, ordinal_position`,
  );
  const tables = [...new Set(columns.map((c) => c.table_name))].filter((t) => !SKIP.has(t)).sort();
  const columnsOf = (t: string) => columns.filter((c) => c.table_name === t).map((c) => c.column_name);
  const isJson = (t: string, c: string) => columns.some((x) => x.table_name === t && x.column_name === c && (x.data_type === "jsonb" || x.data_type === "json"));
  const [sourceTables] = await source.query<mysql.RowDataPacket[]>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  const inSource = new Set(sourceTables.map((r) => String(r.t)));

  const fks = await select<{ table_name: string; name: string; def: string }>(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname AS name, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = current_schema()`,
  );

  const counts: Record<string, number> = {};
  await transaction(async () => {
    for (const table of tables) {
      if (truncate) await exec(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      else if (await first(`SELECT 1 FROM "${table}" LIMIT 1`)) throw new Error(`Target table "${table}" is not empty — use --truncate to replace its data`);
    }
    for (const fk of fks) await exec(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT "${fk.name}"`);

    for (const table of tables) {
      if (!inSource.has(table)) continue;
      const cols = columnsOf(table);
      const [srcCols] = await source.query<mysql.RowDataPacket[]>(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
        [table],
      );
      const shared = cols.filter((c) => srcCols.some((r) => r.c === c));
      const order = shared.includes("id") ? "ORDER BY `id`" : "";
      counts[table] = 0;
      for (let offset = 0; ; offset += BATCH) {
        const [rows] = await source.query<mysql.RowDataPacket[]>(
          `SELECT ${shared.map((c) => `\`${c}\``).join(", ")} FROM \`${table}\` ${order} LIMIT ${BATCH} OFFSET ${offset}`,
        );
        if (!rows.length) break;
        for (const row of rows) {
          const data: Record<string, unknown> = {};
          // JSON ของ mysql2 = object / array / ค่าเดี่ยว (true, 5) → ข้อความ JSON
          for (const c of shared) data[c] = row[c] !== null && isJson(table, c) && typeof row[c] !== "string" ? JSON.stringify(row[c]) : row[c];
          await insert(table, data);
        }
        counts[table] += rows.length;
        if (rows.length < BATCH) break;
      }
    }

    for (const fk of fks) await exec(`ALTER TABLE ${fk.table_name} ADD CONSTRAINT "${fk.name}" ${fk.def}`);
    // sequence ของ id ต่อจากค่าสูงสุด
    for (const table of tables) {
      if (!columnsOf(table).includes("id")) continue;
      const seq = await first<{ s: string | null }>(`SELECT pg_get_serial_sequence('"${table}"', 'id') AS s`);
      if (seq?.s) await select(`SELECT setval('${seq.s}', COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`);
    }
  });

  for (const [t, n] of Object.entries(counts)) if (n) console.info(`${t.padEnd(36)} ${n}`);
  console.info(`Copied ${Object.values(counts).reduce((a, b) => a + b, 0)} rows into PostgreSQL`);
} finally {
  await source.end();
  await closePool();
}
