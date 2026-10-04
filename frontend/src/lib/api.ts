import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrefs } from "@/lib/prefs-server";

/**
 * ตัวเรียก Laravel API — ทำงานบนฝั่ง server เท่านั้น
 * - URL ของ API และ token ไม่ถูกส่งไปที่ browser
 * - token เก็บใน httpOnly cookie (JavaScript ฝั่ง browser อ่านไม่ได้ ป้องกัน XSS ขโมย token)
 */
export const TOKEN_COOKIE = "eam_token";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8020/api/v1";

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
  // FormData (อัปโหลดไฟล์) ต้องให้ fetch ตั้ง Content-Type + boundary เอง
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Accept-Language": locale, // ข้อความ validation / ชื่อสถานะจาก API ตามภาษาที่เลือก
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return fetch(`${API_URL}${path}`, {
    headers: { Accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });
}
