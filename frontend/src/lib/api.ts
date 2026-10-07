import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPrefs } from "@/lib/prefs-server";

/**
 * ตัวเรียก Laravel API — ทำงานบนฝั่ง server เท่านั้น
 * - URL ของ API และ token ไม่ถูกส่งไปที่ browser
 * - token เก็บใน httpOnly cookie (JavaScript ฝั่ง browser อ่านไม่ได้ ป้องกัน XSS ขโมย token)
 */
export const TOKEN_COOKIE = "eam_token";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8020/api/v1";

/**
 * IP ของผู้ใช้ — ส่งต่อให้ API เป็น X-Forwarded-For (log การเปิดดูรหัสผ่าน / จำกัด IP / audit)
 * ใช้ X-Real-IP หรือค่าขวาสุดของ X-Forwarded-For (hop ที่ใกล้ Next.js ที่สุด)
 * เชื่อถือได้เมื่อมี reverse proxy (Caddy / Nginx) เขียนทับ header เหล่านี้หน้า Next.js — Next.js ไม่เขียนทับค่าที่ browser ส่งมาเอง
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").pop()?.trim() || "";
  return /^[0-9a-f.:]{2,45}$/i.test(ip) ? ip : null;
}

/** body ของ 428 จาก API → ข้อมูลสำหรับช่องยืนยันตัวตน (รหัสผ่าน / PIN กลาง) */
export function reauthChallenge(e: ApiError): import("@/lib/types").ReauthChallenge {
  const b = e.body as Record<string, unknown>;
  return { method: b.reauth === "pin" ? "pin" : "password", pin_set: Boolean(b.pin_set), pin_locked: Boolean(b.pin_locked), message: e.message };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { message?: string; errors?: Record<string, string[]> },
  ) {
    super(body.message ?? `API error ${status}`);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const { locale } = await getPrefs();
  const ip = await clientIp();
  // FormData (อัปโหลดไฟล์) ต้องให้ fetch ตั้ง Content-Type + boundary เอง
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Accept-Language": locale, // ข้อความ validation / ชื่อสถานะจาก API ตามภาษาที่เลือก
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { "X-Forwarded-For": ip } : {}),
      ...init.headers,
    },
    cache: "no-store", // ข้อมูลเฉพาะผู้ใช้ ห้าม cache ข้ามผู้ใช้
  });

  if (res.status === 401) {
    redirect("/login?expired=1");
  }
  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

/** ดึงไฟล์ (รูป/เอกสาร/ลายเซ็น) จาก API แบบ binary — ใช้ใน route handler ที่ส่งต่อให้ browser */
export async function apiFile(path: string): Promise<Response> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const ip = await clientIp();
  return fetch(`${API_URL}${path}`, {
    headers: { Accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) },
    cache: "no-store",
  });
}
