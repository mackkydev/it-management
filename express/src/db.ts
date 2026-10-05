import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { config } from "./config.js";

/**
 * MySQL 8.4 (driver mysql2)
 * - เขียน SQL ด้วย placeholder "?" — แทนค่าที่ escape แล้วฝั่งเรา (ข้าม "?" ที่อยู่ใน '...' / "...") ส่ง array = รายการสำหรับ IN (?)
 * - session ใช้ sql_mode ANSI_QUOTES: "ชื่อคอลัมน์" = identifier (ใช้กับคอลัมน์ที่เป็นคำสงวน เช่น "key", "before", "group")
 * - วันที่/เวลาคืนเป็น string ตามที่เก็บ (DATETIME(0) แบบ UTC) แล้วแปลงเป็น ISO ใน resource
 * - BIGINT (id, COUNT) คืนเป็น number, DECIMAL คืนเป็น string ("1234.50"), BOOLEAN (TINYINT(1)) คืนเป็น true/false, JSON คืนเป็น object
 * - query ใน transaction() ใช้ connection เดียวกันอัตโนมัติ (AsyncLocalStorage)
 */
export type Row = Record<string, any>;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const base = mysql.createPool({
    ...config.db,
    connectionLimit: 10,
    // handshake ส่ง collation id ได้ไม่เกิน 255 — ตั้ง utf8mb4_0900_as_ci (id 305) ด้วย SET NAMES ตอนเชื่อมต่อแทน
    charset: "utf8mb4",
    // เวลาในฐานข้อมูลเป็น UTC เสมอ (เหมือน Laravel app.timezone = UTC)
    timezone: "Z",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: false,
    typeCast(field, next) {
      if (field.type === "TINY" && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === "1";
      }
      return next();
    },
  });
  base.on("connection", (conn) => {
    conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci, SESSION sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES'), time_zone = '+00:00'");
  });
  pool = base.promise();
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

const txStore = new AsyncLocalStorage<PoolConnection>();

/** ค่าพารามิเตอร์ → SQL: object ธรรมดา = JSON (เหมือน pg), array = รายการสำหรับ IN (?) */
function escapeValue(v: unknown): string {
  const plainObject = v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);
  return mysql.escape((plainObject ? JSON.stringify(v) : v) as Parameters<typeof mysql.escape>[0], true, "Z");
}

/** แทน "?" ด้วยค่าที่ escape แล้ว (ข้าม "?" ที่อยู่ใน '...' หรือ "...") */
export function formatSql(sql: string, params: unknown[]): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      if (n >= params.length) throw new Error("Not enough SQL parameters");
      out += escapeValue(params[n++]);
    } else {
      out += ch;
    }
  }
  return out;
}

async function run(sql: string, params: unknown[]): Promise<Row[] | ResultSetHeader> {
  const client = txStore.getStore() ?? getPool();
  const [result] = await client.query(formatSql(sql, params));
  return result as Row[] | ResultSetHeader;
}

export async function select<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await run(sql, params)) as T[];
}

export async function first<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await select<T>(sql, params))[0] as T | undefined) ?? null;
}

export async function scalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const row = await first<Row>(sql, params);
  return row ? (Object.values(row)[0] as T) : null;
}

export async function exec(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  return { rowCount: ((await run(sql, params)) as ResultSetHeader).affectedRows ?? 0 };
}

/** INSERT จาก object (ข้ามค่า undefined) → คืน id ของแถวใหม่ (ตารางที่ไม่มี AUTO_INCREMENT = 0) */
export async function insert(table: string, data: Record<string, unknown>): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const res = (await run(`INSERT INTO "${table}" (${cols}) VALUES (${entries.map(() => "?").join(", ")})`, entries.map(([, v]) => v))) as ResultSetHeader;
  return Number(res.insertId);
}

/** UPDATE จาก object (ข้ามค่า undefined) → จำนวนแถวที่ตรงเงื่อนไข */
export async function update(table: string, data: Record<string, unknown>, where: string, params: unknown[]): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  const res = (await run(`UPDATE "${table}" SET ${sets} WHERE ${where}`, [...entries.map(([, v]) => v), ...params])) as ResultSetHeader;
  return res.affectedRows ?? 0;
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // nested → ใช้ transaction เดิม
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await txStore.run(conn, fn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    // ปลด lock ของ lockNamed() พร้อมจบ transaction
    await conn.query("DO RELEASE_ALL_LOCKS()").catch(() => undefined);
    conn.release();
  }
}

/** lock ตามชื่อจนจบ transaction (แทน pg_advisory_xact_lock) — เรียกภายใน transaction() เท่านั้น */
export async function lockNamed(name: string, timeoutSeconds = 10): Promise<void> {
  if (!txStore.getStore()) throw new Error("lockNamed() must be called inside transaction()");
  if (Number(await scalar("SELECT GET_LOCK(?, ?)", [name, timeoutSeconds])) !== 1) throw new Error(`Could not acquire lock "${name}"`);
}

/** escape wildcard ของ LIKE (escape character ตั้งต้นของ MySQL คือ \) */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** รูปแบบ UUID — ตรวจก่อน query คอลัมน์ uuid (ค่าไม่ถูกรูปแบบ = ไม่พบ) */
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
