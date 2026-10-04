import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "./config.js";

/**
 * PostgreSQL (driver pg)
 * - เขียน SQL ด้วย placeholder "?" ได้ (แปลงเป็น $1, $2, ... ให้อัตโนมัติ) — ให้ query builder ใน route อ่านง่าย
 * - วันที่/เวลาคืนเป็น string ตามที่เก็บ (timestamp(0) แบบ UTC ไม่มี timezone) แล้วแปลงเป็น ISO ใน resource
 * - bigint (id, COUNT) คืนเป็น number, NUMERIC คืนเป็น string ("1234.50")
 * - query ใน transaction() ใช้ connection เดียวกันอัตโนมัติ (AsyncLocalStorage)
 */
export type Row = Record<string, any>;

const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    switch (oid) {
      case pg.types.builtins.INT8:
        return (v: string) => Number(v); // id / COUNT(*) — ค่าในระบบไม่เกิน 2^53
      case pg.types.builtins.DATE:
      case pg.types.builtins.TIMESTAMP:
      case pg.types.builtins.TIMESTAMPTZ:
        return (v: string) => v; // คงเป็น string — แปลงรูปแบบใน lib/time.ts
      default:
        return pg.types.getTypeParser(oid, format as "text");
    }
  },
} as pg.CustomTypesConfig;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    ...config.db,
    max: 10,
    types,
    // เวลาในฐานข้อมูลเป็น UTC เสมอ (เหมือน Laravel app.timezone = UTC)
    options: "-c timezone=UTC",
  });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

const txStore = new AsyncLocalStorage<pg.PoolClient>();

/** แปลง "?" เป็น $1, $2, ... (ข้าม "?" ที่อยู่ใน '...' หรือ "...") */
export function toPositional(sql: string): string {
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
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

async function run(sql: string, params: unknown[]): Promise<pg.QueryResult<Row>> {
  const client = txStore.getStore() ?? getPool();
  return client.query(toPositional(sql), params);
}

export async function select<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await run(sql, params)).rows as T[];
}

export async function first<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await run(sql, params)).rows[0] as T | undefined) ?? null;
}

export async function scalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const row = await first<Row>(sql, params);
  return row ? (Object.values(row)[0] as T) : null;
}

export async function exec(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  return { rowCount: (await run(sql, params)).rowCount ?? 0 };
}

/** INSERT จาก object (ข้ามค่า undefined) → คืน id ของแถวใหม่ */
export async function insert(table: string, data: Record<string, unknown>): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const res = await run(`INSERT INTO "${table}" (${cols}) VALUES (${entries.map(() => "?").join(", ")}) RETURNING id`, entries.map(([, v]) => v));
  return res.rows[0]?.id as number;
}

/** UPDATE จาก object (ข้ามค่า undefined) → จำนวนแถวที่แก้ */
export async function update(table: string, data: Record<string, unknown>, where: string, params: unknown[]): Promise<number> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  const res = await run(`UPDATE "${table}" SET ${sets} WHERE ${where}`, [...entries.map(([, v]) => v), ...params]);
  return res.rowCount ?? 0;
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // nested → ใช้ transaction เดิม
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await txStore.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** escape wildcard ของ LIKE/ILIKE (escape character ตั้งต้นของ PostgreSQL คือ \) */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** รูปแบบ UUID — ตรวจก่อน query คอลัมน์ uuid (ค่าไม่ถูกรูปแบบ = ไม่พบ แทนที่จะเป็น error ของฐานข้อมูล) */
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
