import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors.js";

/**
 * จำกัดจำนวน request ต่อช่วงเวลา (เทียบเท่า RateLimiter ของ Laravel: api / login / throttle:30,1)
 * เก็บในหน่วยความจำของ process — ถ้ารันหลาย instance ให้เปลี่ยนไปใช้ Redis
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface Limit {
  max: number;
  windowSeconds: number;
  key: (req: Request) => string;
}

function hit(name: string, limit: Limit, req: Request): { ok: boolean; remaining: number; retryAfter: number } {
  const key = `${name}:${limit.key(req)}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + limit.windowSeconds * 1000 };
    buckets.set(key, b);
  }
  b.count++;
  return { ok: b.count <= limit.max, remaining: Math.max(0, limit.max - b.count), retryAfter: Math.ceil((b.resetAt - now) / 1000) };
}

/** หลาย limit ใน middleware เดียว (เช่น login = ต่ออีเมล+IP และต่อ IP) */
export function throttle(name: string, ...limits: Limit[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const [i, limit] of limits.entries()) {
      const r = hit(`${name}#${i}`, limit, req);
      if (i === 0) {
        res.setHeader("X-RateLimit-Limit", String(limit.max));
        res.setHeader("X-RateLimit-Remaining", String(r.remaining));
      }
      if (!r.ok) {
        throw new HttpError(429, "Too Many Attempts.", { "Retry-After": String(r.retryAfter), "X-RateLimit-Remaining": "0" });
      }
    }
    next();
  };
}

/** ล้างค่าที่นับไว้ (ใช้ในเทสต์) */
export function resetRateLimits() {
  buckets.clear();
}

// ล้าง bucket ที่หมดอายุทุก 5 นาที กันหน่วยความจำโต
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 300_000).unref();

const ip = (req: Request) => req.ip ?? "unknown";

export const limits = {
  /** api: 120 ครั้ง/นาที ต่อผู้ใช้ (หรือ IP) */
  api: throttle("api", { max: 120, windowSeconds: 60, key: (req) => (req.user ? `u${req.user.id}` : ip(req)) }),
  /** login: 5 ครั้ง/นาที ต่ออีเมล+IP และ 20 ครั้ง/นาที ต่อ IP */
  login: throttle(
    "login",
    { max: 5, windowSeconds: 60, key: (req) => `${String(req.body?.email ?? "").toLowerCase()}|${ip(req)}` },
    { max: 20, windowSeconds: 60, key: ip },
  ),
  /** throttle:30,1 — เปิดดูรหัสผ่าน */
  reveal: throttle("reveal", { max: 30, windowSeconds: 60, key: (req) => (req.user ? `u${req.user.id}` : ip(req)) }),
};
