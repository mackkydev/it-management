import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/**
 * cache ต่อ 1 request — ค่าที่อ่านซ้ำหลายครั้งใน request เดียว (เช่น app_settings ที่ middleware auth / สิทธิ์ / นโยบาย อ่านทุก request)
 * อ่านจากฐานข้อมูลครั้งเดียวแล้วใช้ซ้ำ — จบ request = ทิ้ง (ไม่มีค่าค้างข้าม request) นอก request (scheduler / เทสต์) = อ่านตรงทุกครั้ง
 */
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function requestCache(_req: Request, _res: Response, next: NextFunction) {
  store.run(new Map(), next);
}

/** ค่าของ key ใน request นี้ (โหลดครั้งแรกด้วย load) — โหลดไม่สำเร็จ = ไม่เก็บ */
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const map = store.getStore();
  if (!map) return load();
  let value = map.get(key) as Promise<T> | undefined;
  if (!value) {
    value = load();
    map.set(key, value);
    value.catch(() => map.delete(key));
  }
  return value;
}

/** ล้างค่าที่ขึ้นต้นด้วย prefix (หลังบันทึกค่านั้นใน request เดียวกัน) */
export function forgetCached(prefix: string): void {
  const map = store.getStore();
  if (!map) return;
  for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
}
