"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch, TOKEN_COOKIE } from "@/lib/api";
import type { User } from "@/lib/types";
import { WELCOME_COOKIE } from "@/lib/welcome";

export interface LoginState {
  error?: string;
  email?: string;
  /** login ผ่านระบบต้นทาง (API User) */
  username?: string;
  connectionId?: string;
}

type LoginResult = { token: string; expires_at: string; user: User };

/** cookie ของ session: httpOnly + SameSite=Lax และ Secure เสมอ ยกเว้นเปิดผ่าน localhost (เครื่องพัฒนา) */
async function startSession(result: LoginResult) {
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const secure = !(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost"));
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, result.token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(result.expires_at) });
  // ให้หน้าแรกหลัง login แสดงสรุปการแจ้งเตือนที่ยังไม่อ่าน / งานรออนุมัติ (ครั้งเดียว)
  jar.set(WELCOME_COOKIE, "1", { sameSite: "lax", path: "/", maxAge: 600, secure });
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: t("auth.required"), email };
  }

  let result: LoginResult;
  try {
    result = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, device_name: "web" }),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { error: t("auth.throttled"), email };
      return { error: e.body.errors?.email?.[0] ?? t("auth.failed"), email }; // ข้อความจาก API แปลตามภาษาแล้ว
    }
    return { error: t("auth.unreachable"), email };
  }

  await startSession(result);
  redirect("/"); // หน้าแรกเลือกปลายทางตามผู้ใช้ (IT → คิวงาน IT, คนอื่น → ใบแจ้งงานของฉัน)
}

/** login ผ่านระบบต้นทาง — รหัสผ่านส่งต่อให้ API (ที่ส่งต่อไปต้นทาง) เท่านั้น ไม่เก็บที่ใด */
export async function loginWithConnection(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const connectionId = String(formData.get("connection_id") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!/^\d+$/.test(connectionId) || !username || !password) {
    return { error: t("auth.requiredUsername"), username, connectionId };
  }

  let result: LoginResult;
  try {
    result = await apiFetch("/auth/api-login", {
      method: "POST",
      body: JSON.stringify({ connection_id: Number(connectionId), username, password, device_name: "web" }),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { error: t("auth.throttled"), username, connectionId };
      return { error: e.body.errors?.username?.[0] ?? t("auth.failed"), username, connectionId };
    }
    return { error: t("auth.unreachable"), username, connectionId };
  }

  await startSession(result);
  redirect("/");
}

export async function logout() {
  try {
    await apiFetch("/auth/logout", { method: "POST" }); // เพิกถอน token ที่ API (API User: แจ้ง logout ที่ต้นทางด้วย)
  } catch {
    // token อาจหมดอายุไปแล้ว — ลบ cookie ต่อได้เลย
  }
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  jar.delete(WELCOME_COOKIE);
  redirect("/login");
}
