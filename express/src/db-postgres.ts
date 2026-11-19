import pg from "pg";
import { config } from "./config.js";

/**
 * PostgreSQL 18 (DB_CLIENT=postgres, driver pg) — ใช้ร่วมกับ db.ts ให้โค้ดเดิมเขียน SQL แบบ MySQL ชุดเดียว
 * - translatePg() แปลงไวยากรณ์ MySQL ที่ใช้ในโปรเจกต์เป็น PostgreSQL ตอนส่ง query (ทำกับข้อความ SQL ก่อนแทนค่า "?" จึงไม่แตะข้อมูลผู้ใช้)
 * - ฟังก์ชัน/operator ที่แปลงด้วยข้อความไม่ได้อยู่ใน migration prisma/postgres/migrations/1_mysql_compat (<=>, FIELD, CONVERT_TZ, citext = ตัวเลข)
 * - ข้อความทุกคอลัมน์เป็น citext → เทียบ/ค้นหา/UNIQUE ไม่สนตัวพิมพ์เหมือน utf8mb4_0900_as_ci
 * - ผลลัพธ์รูปแบบเดียวกับ mysql2: DATE / TIMESTAMP = string, BIGINT = number, NUMERIC = string, JSON = object
 * - session ตั้ง TimeZone = UTC (NOW() / LOCALTIMESTAMP = เวลา UTC เหมือน time_zone '+00:00' ของ MySQL)
 */

const { types } = pg;
const asString = (v: string) => v;
const parsers: Record<number, (v: string) => unknown> = {
  1082: asString, // date
  1114: asString, // timestamp
  1184: asString, // timestamptz
  1083: asString, // time
  20: (v) => Number(v), // int8 (id, COUNT)
};
const typeParser = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => parsers[oid] ?? types.getTypeParser(oid, format)) as typeof types.getTypeParser,
};

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.dbPoolSize,
    options: "-c TimeZone=UTC -c DateStyle=ISO",
    types: typeParser,
  });
  // connection ว่างที่หลุด (เช่น ฐานข้อมูล restart) ต้องไม่ทำให้ process ล้ม
  pool.on("error", () => undefined);
  return pool;
}

export async function closePgPool(): Promise<void> {
  await pool?.end();
  pool = null;
  meta = null;
}

/* ---------- escape ค่า ("?" → literal) ---------- */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** ค่าพารามิเตอร์ → SQL ของ PostgreSQL (standard_conforming_strings: backslash เป็นตัวอักษรปกติ) */
export function escapePg(v: unknown, nested = false): string {
  if (v === undefined || v === null) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "NULL";
    return quote(
      `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}.${pad(v.getUTCMilliseconds(), 3)}`,
    );
  }
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  if (Array.isArray(v)) {
    // array = รายการสำหรับ IN (?) / array ซ้อน = หลายแถว (a, b), (c, d) — เหมือน mysql.escape
    return v.map((x) => (Array.isArray(x) && !nested ? `(${x.map((y) => escapePg(y, true)).join(", ")})` : escapePg(x, true))).join(", ");
  }
  if (typeof v === "object") return quote(JSON.stringify(v));
  return quote(String(v).replace(/\0/g, ""));
}

/* ---------- ข้อมูลโครงสร้าง (ON CONFLICT target, ตารางที่มี id อัตโนมัติ) ---------- */

interface Meta {
  /** ตาราง → คอลัมน์ของ unique key ที่ใช้เป็น ON CONFLICT (unique ที่ไม่ใช่ PK ก่อน ไม่มีจึงใช้ PK) */
  conflict: Map<string, string[]>;
  /** ตารางที่มีคอลัมน์ id แบบ serial — INSERT คืน id */
  serial: Set<string>;
}
let meta: Meta | null = null;

export async function loadPgMeta(client: pg.Pool | pg.PoolClient): Promise<Meta> {
  if (meta) return meta;
  const uniques = await client.query<{ tbl: string; pk: boolean; cols: string[] }>(
    `SELECT t.relname AS tbl, i.indisprimary AS pk, array_agg(a.attname::text ORDER BY k.n) AS cols
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace ns ON ns.oid = t.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE i.indisunique AND ns.nspname = current_schema()
      GROUP BY t.relname, i.indexrelid, i.indisprimary
      ORDER BY t.relname, i.indisprimary, i.indexrelid`,
  );
  const conflict = new Map<string, string[]>();
  for (const r of uniques.rows) if (!conflict.has(r.tbl)) conflict.set(r.tbl, r.cols);
  const serials = await client.query<{ tbl: string }>(
    `SELECT table_name AS tbl FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'id' AND column_default LIKE 'nextval(%'`,
  );
  meta = { conflict, serial: new Set(serials.rows.map((r) => r.tbl)) };
  return meta;
}

export function hasSerialId(m: Meta, table: string): boolean {
  return m.serial.has(table);
}

/* ---------- แปลงไวยากรณ์ MySQL → PostgreSQL ---------- */

const UNIT = "(MICROSECOND|SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)";
/** INTERVAL <ค่า> UNIT — ค่า = ตัวเลข / ? / คอลัมน์ / ฟังก์ชันหนึ่งชั้น เช่น COALESCE(a, ?) */
const INTERVAL_RE = new RegExp(String.raw`\bINTERVAL\s+(\w+\([^()]*\)|[\w.?"]+)\s+${UNIT}\b`, "gi");
const INSERT_TABLE_RE = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+"?([A-Za-z_]\w*)"?/i;

/**
 * ข้อความใน '...' ที่เขียนในโค้ดแบบ MySQL (backslash = escape เช่น 'App\\Notifications') → E'...' ของ PostgreSQL ที่ตีความ backslash เหมือนกัน
 * ทำก่อนแทนค่า "?" — ค่าจากผู้ใช้ escape ด้วย escapePg() แยกต่างหาก
 */
function backslashLiterals(sql: string): string {
  if (!sql.includes("\\")) return sql;
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === "'") {
      let j = i + 1;
      let hasBackslash = false;
      while (j < sql.length) {
        if (sql[j] === "\\") {
          hasBackslash = true;
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      const lit = sql.slice(i, j + 1);
      out += hasBackslash && !/[eE]$/.test(out) ? `E${lit}` : lit;
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function translatePg(sql: string, m: Meta): string {
  let s = backslashLiterals(sql);
  const table = INSERT_TABLE_RE.exec(s)?.[1];

  // INSERT IGNORE → ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+IGNORE\s+INTO/i.test(s)) s = `${s.replace(/^(\s*INSERT)\s+IGNORE(\s+INTO)/i, "$1$2").replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;

  // ... AS new ON DUPLICATE KEY UPDATE a = new.a / VALUES(a) → ON CONFLICT (unique key) DO UPDATE SET a = EXCLUDED.a
  const dup = /(?:\s+AS\s+new)?\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+/i.exec(s);
  if (dup && table) {
    const cols = m.conflict.get(table);
    if (!cols) throw new Error(`ON DUPLICATE KEY: no unique key on "${table}"`);
    const sets = s
      .slice(dup.index + dup[0].length)
      .replace(/\bnew\./g, "EXCLUDED.")
      .replace(/\bVALUES\(\s*("?\w+"?)\s*\)/gi, "EXCLUDED.$1");
    s = `${s.slice(0, dup.index)} ON CONFLICT (${cols.map((c) => `"${c}"`).join(", ")}) DO UPDATE SET ${sets}`;
  }

  return (
    s
      // `ชื่อ` (backtick) → "ชื่อ"
      .replace(/`(\w+)`/g, '"$1"')
      // JSON: JSON_UNQUOTE(JSON_EXTRACT(x, '$.k')) / x->>'$.k' → x::jsonb->>'k' (คอลัมน์ข้อความที่เก็บ JSON ก็ใช้ได้)
      .replace(/JSON_UNQUOTE\(\s*JSON_EXTRACT\(\s*([^,()]+?)\s*,\s*'\$\.(\w+)'\s*\)\s*\)/gi, "($1::jsonb->>'$2')")
      .replace(/->>\s*'\$\.(\w+)'/g, "::jsonb->>'$1'")
      .replace(/\bJSON_CONTAINS\(\s*([^,()]+?)\s*,\s*\?\s*\)/gi, "($1::jsonb @> CAST(? AS JSONB))")
      // วันเวลา
      .replace(/\bUTC_TIMESTAMP\(\)/gi, "LOCALTIMESTAMP(0)")
      .replace(/\bDATE_ADD\(/gi, "eam_date_add(")
      .replace(/\bDATE_SUB\(/gi, "eam_date_sub(")
      .replace(INTERVAL_RE, (_m, n: string, unit: string) => `((${n}) * INTERVAL '1 ${unit.toLowerCase()}')`)
      // ชนิดข้อมูลใน CAST
      .replace(/\bAS\s+CHAR\s*\)/gi, "AS TEXT)")
      .replace(/\bAS\s+(?:UNSIGNED|SIGNED)(?:\s+INTEGER)?\s*\)/gi, "AS BIGINT)")
      .replace(/\bAS\s+DATETIME\s*\)/gi, "AS TIMESTAMP(0))")
      // ข้อความ
      .replace(/\bGROUP_CONCAT\(\s*([^()]+?)(\s+ORDER\s+BY\s+[^()]+?)?\s*\)/gi, (_m, expr: string, order = "") => `string_agg(CAST(${expr} AS TEXT), ','${order})`)
      .replace(/\bSUBSTRING_INDEX\(/gi, "eam_substring_index(")
  );
}
