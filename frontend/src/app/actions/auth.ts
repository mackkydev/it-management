"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch, TOKEN_COOKIE } from "@/lib/api";
import type { User } from "@/lib/types";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: t("auth.required"), email };
  }

  let result: { token: string; expires_at: string; user: User };
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

  (await cookies()).set(TOKEN_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(result.expires_at),
  });

  redirect("/tickets");
}

export async function logout() {
  try {
    await apiFetch("/auth/logout", { method: "POST" }); // เพิกถอน token ที่ฝั่ง Laravel
  } catch {
    // token อาจหมดอายุไปแล้ว — ลบ cookie ต่อได้เลย
  }
  (await cookies()).delete(TOKEN_COOKIE);
  redirect("/login");
}
