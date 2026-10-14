import { NextResponse, type NextRequest } from "next/server";

// ต้องตรงกับ TOKEN_COOKIE ใน src/lib/api.ts (proxy ไม่ควร import module ร่วมกับ render code)
const TOKEN_COOKIE = "eam_token";

/**
 * Content-Security-Policy ต่อ request (คู่มือ Next.js: content-security-policy.md)
 * - script: nonce ใหม่ทุก request + 'strict-dynamic' — Next.js ใส่ nonce ให้สคริปต์ของตัวเองอัตโนมัติ, สคริปต์ inline ของเราอ่านจาก header x-nonce
 *   (dev ต้องมี 'unsafe-eval' ให้ React แสดง error stack)
 * - style: 'unsafe-inline' — หน้าเว็บใช้ style attribute (ตำแหน่งแถบในปฏิทิน/ไทม์ไลน์, ทูลทิป, ธีมสีกำหนดเอง) ซึ่ง nonce ใช้กับ attribute ไม่ได้
 * - รูป/ฟอนต์/ไฟล์/การเชื่อมต่อ = โดเมนเดียวกันเท่านั้น (ไฟล์ส่วนตัวผ่าน /files, ฟอนต์จาก next/font โหลดจากโดเมนเราเอง)
 * - upgrade-insecure-requests เฉพาะเมื่อเปิดผ่าน https (เปิดผ่าน http ในวงแลน = ไม่ใส่ ไม่งั้นไฟล์ประกอบโหลดไม่ขึ้น)
 */
function contentSecurityPolicy(nonce: string, https: boolean): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** ตรวจเบื้องต้นว่ามี token หรือไม่ — การตรวจสิทธิ์จริงทำที่ API ทุก request */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = contentSecurityPolicy(nonce, https);
  const withCsp = (response: NextResponse) => (response.headers.set("Content-Security-Policy", csp), response);
  // ส่ง nonce + CSP ไปกับ request ให้ Next.js ใส่ nonce ตอน render (layout อ่าน x-nonce ใส่สคริปต์ inline ของเรา)
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return withCsp(NextResponse.next({ request: { headers } }));
  };

  const hasToken = request.cookies.has(TOKEN_COOKIE);
  const isLoginPage = request.nextUrl.pathname === "/login";
  // /sync ตรวจ token เองแล้วตอบ 204 — หน้า login ใช้ ?scope=public ได้โดยไม่ต้องมี token
  if (request.nextUrl.pathname === "/sync") return next();
  // ลิงก์ iCal ส่วนตัว — Outlook / Google Calendar เรียกโดยไม่มี cookie (ใช้ token ใน URL แทน)
  if (request.nextUrl.pathname.startsWith("/ical/")) return next();

  if (!hasToken && !isLoginPage) {
    return withCsp(NextResponse.redirect(new URL("/login", request.url)));
  }
  if (hasToken && isLoginPage && !request.nextUrl.searchParams.has("expired")) {
    return withCsp(NextResponse.redirect(new URL("/", request.url)));
  }
  return next();
}

export const config = {
  // ไฟล์ PWA (manifest / service worker / หน้า offline) ต้องโหลดได้โดยไม่ต้อง login
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
