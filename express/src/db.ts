import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2";
import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import type pg from "pg";
import { config } from "./config.js";
import { closePgPool, escapePg, getPgPool, hasSerialId, loadPgMeta, translatePg } from "./db-postgres.js";

/**
 * ฐานข้อมูลเลือกด้วย DB_CLIENT: mysql (ค่าตั้งต้น — MySQL 8.4, driver mysql2) / postgres (PostgreSQL 18, driver pg — ดู db-postgres.ts)
 * โค้ดทั้งหมดเขียน SQL แบบ MySQL ชุดเดียว — ฝั่ง PostgreSQL แปลงไวยากรณ์ให้ตอนส่ง query และคืนผลรูปแบบเดียวกัน
 *
 * MySQL 8.4 (driver mysql2)
 * - เขียน SQL ด้วย placeholder "?" — แทนค่าที่ escape แล้วฝั่งเรา (ข้าม "?" ที่อยู่ใน '...' / "...") ส่ง array = รายการสำหรับ IN (?)
 * - session ใช้ sql_mode ANSI_QUOTES: "ชื่อคอลัมน์" = identifier (ใช้กับคอลัมน์ที่เป็นคำสงวน เช่น "key", "before", "group")
 * - วันที่/เวลาคืนเป็น string ตามที่เก็บ (DATETIME(0) แบบ UTC) แล้วแปลงเป็น ISO ใน resource
 * - BIGINT (id, COUNT) คืนเป็น number, DECIMAL คืนเป็น string ("1234.50"), BOOLEAN (TINYINT(1)) คืนเป็น true/false, JSON คืนเป็น object
 * - query ใน transaction() ใช้ connection เดียวกันอัตโนมัติ (AsyncLocalStorage)
 * - INSERT / UPDATE / DELETE ที่สำเร็จแจ้ง onCommittedWrite() พร้อมชื่อตาราง (ใน transaction = หลัง commit) — routes/sync.ts ใช้นับเวอร์ชันข้อมูล
 */
export type Row = Record<string, any>;

let pool: Pool | null = null;

export const isPostgres = config.dbClient === "postgres";

/** ตรวจการเชื่อมต่อ (ตอนเปิด server) */
export async function ping(): Promise<void> {
  await select("SELECT 1");
}

export function getPool(): Pool {
  if (pool) return pool;
  const base = mysql.createPool({
    ...config.db,
    // ขนาด pool ตั้งได้ด้วย DB_POOL_SIZE (ตั้งต้น 10) — เพิ่มเมื่อผู้ใช้พร้อมกันมากขึ้น (ไม่เกิน max_connections ของ MySQL)
    connectionLimit: config.dbPoolSize,
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
  if (isPostgres) return closePgPool();
  await pool?.end();
  pool = null;
}

interface TxContext {
  conn?: PoolConnection;
  /** connection ของ PostgreSQL (DB_CLIENT=postgres) */
  pgConn?: pg.PoolClient;
  /** ตารางที่ถูกเขียนใน transaction นี้ — แจ้ง listener หลัง commit เท่านั้น (rollback = ไม่แจ้ง) */
  writes: Set<string>;
}
const txStore = new AsyncLocalStorage<TxContext>();

type WriteListener = (tables: string[]) => void;
const writeListeners = new Set<WriteListener>();
/** ฟังการเขียนข้อมูลที่บันทึกแล้ว (ชื่อตาราง) — คืนฟังก์ชันเลิกฟัง */
export function onCommittedWrite(fn: WriteListener): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}
function emitWrites(tables: string[]) {
  for (const fn of writeListeners) {
    try {
      fn(tables);
    } catch {
      // listener ผิดพลาดต้องไม่ทำให้การบันทึกข้อมูลล้ม
    }
  }
}
const WRITE_RE = /^\s*(?:INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+IGNORE)?|DELETE\s+FROM)\s+["`]?([A-Za-z_]\w*)/i;

/** ค่าพารามิเตอร์ → SQL: object ธรรมดา = JSON (เหมือน pg), array = รายการสำหรับ IN (?) */
function escapeValue(v: unknown): string {
  const plainObject = v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);
  return mysql.escape((plainObject ? JSON.stringify(v) : v) as Parameters<typeof mysql.escape>[0], true, "Z");
}

/** แทน "?" ด้วยค่าที่ escape แล้ว (ข้าม "?" ที่อยู่ใน '...' หรือ "...") */
export function formatSql(sql: string, params: unknown[], escape: (v: unknown) => string = isPostgres ? escapePg : escapeValue): string {
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
      out += escape(params[n++]);
    } else {
      out += ch;
    }
  }
  return out;
}

/** ผลของ INSERT / UPDATE / DELETE (รูปแบบเดียวกันทั้งสองฐาน) */
interface WriteResult {
  affectedRows: number;
  insertId: number;
}

async function run(sql: string, params: unknown[], opts: { returningId?: boolean } = {}): Promise<Row[] | WriteResult> {
  const ctx = txStore.getStore();
  let result: Row[] | WriteResult;
  if (isPostgres) {
    const client = ctx?.pgConn ?? getPgPool();
    const meta = await loadPgMeta(client);
    const table = INSERT_RE.exec(sql)?.[1];
    let text = formatSql(translatePg(sql, meta), params);
    const withId = opts.returningId && table && hasSerialId(meta, table);
    if (withId) text += ' RETURNING "id"';
    const res = await client.query(text).catch((e: unknown) => {
      if (process.env.DEBUG_PG_SQL) console.error(`[pg] ${(e as Error).message}\n${text}`);
      throw e;
    });
    result = res.command === "SELECT" || (res.fields?.length && !withId) ? (res.rows as Row[]) : { affectedRows: res.rowCount ?? 0, insertId: withId ? Number(res.rows[0]?.id ?? 0) : 0 };
  } else {
    const [r] = await (ctx?.conn ?? getPool()).query(formatSql(sql, params));
    result = Array.isArray(r) ? (r as Row[]) : { affectedRows: (r as ResultSetHeader).affectedRows ?? 0, insertId: Number((r as ResultSetHeader).insertId ?? 0) };
  }
  const table = WRITE_RE.exec(sql)?.[1];
  if (table) {
    if (ctx) ctx.writes.add(table);
    else emitWrites([table]);
  }
  return result;
}
const INSERT_RE = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+"?([A-Za-z_]\w*)"?/i;

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
  return { rowCount: ((await run(sql, params)) as WriteResult).affectedRows ?? 0 };
}

/** INSERT จาก object (ข้ามค่า undefined) → คืน id ของแถวใหม่ (ตารางที่ไม่มี AUTO_INCREMENT = 0) */
export async function insert(table: string, data: Record<string, unknown>): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const res = (await run(`INSERT INTO "${table}" (${cols}) VALUES (${entries.map(() => "?").join(", ")})`, entries.map(([, v]) => v), { returningId: true })) as WriteResult;
  return Number(res.insertId);
}

/** UPDATE จาก object (ข้ามค่า undefined) → จำนวนแถวที่ตรงเงื่อนไข */
export async function update(table: string, data: Record<string, unknown>, where: string, params: unknown[]): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  const res = (await run(`UPDATE "${table}" SET ${sets} WHERE ${where}`, [...entries.map(([, v]) => v), ...params])) as WriteResult;
  return res.affectedRows ?? 0;
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // nested → ใช้ transaction เดิม
  if (isPostgres) return pgTransaction(fn);
  const conn = await getPool().getConnection();
  const ctx: TxContext = { conn, writes: new Set() };
  try {
    await conn.beginTransaction();
    const result = await txStore.run(ctx, fn);
    await conn.commit();
    if (ctx.writes.size) emitWrites([...ctx.writes]);
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

async function pgTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const pgConn = await getPgPool().connect();
  const ctx: TxContext = { pgConn, writes: new Set() };
  try {
    await pgConn.query("BEGIN");
    const result = await txStore.run(ctx, fn);
    await pgConn.query("COMMIT");
    if (ctx.writes.size) emitWrites([...ctx.writes]);
    return result;
  } catch (e) {
    await pgConn.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    pgConn.release(); // pg_advisory_xact_lock ปลดเองเมื่อจบ transaction
  }
}

/** lock ตามชื่อจนจบ transaction (MySQL GET_LOCK / PostgreSQL pg_advisory_xact_lock) — เรียกภายใน transaction() เท่านั้น */
export async function lockNamed(name: string, timeoutSeconds = 10): Promise<void> {
  if (!txStore.getStore()) throw new Error("lockNamed() must be called inside transaction()");
  if (isPostgres) {
    await exec(`SET LOCAL lock_timeout = '${Math.max(1, Math.round(timeoutSeconds))}s'`);
    try {
      await select("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [name]);
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") throw new Error(`Could not acquire lock "${name}"`);
      throw e;
    }
    await exec("SET LOCAL lock_timeout = 0");
    return;
  }
  if (Number(await scalar("SELECT GET_LOCK(?, ?)", [name, timeoutSeconds])) !== 1) throw new Error(`Could not acquire lock "${name}"`);
}

/** escape wildcard ของ LIKE (escape character ตั้งต้นของ MySQL และ PostgreSQL คือ \) */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** รูปแบบ UUID — ตรวจก่อน query คอลัมน์ uuid (ค่าไม่ถูกรูปแบบ = ไม่พบ) */
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
