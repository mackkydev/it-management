import { NextResponse, type NextRequest } from "next/server";

// ต้องตรงกับ TOKEN_COOKIE ใน src/lib/api.ts (proxy ไม่ควร import module ร่วมกับ render code)
const TOKEN_COOKIE = "eam_token";

/** ตรวจเบื้องต้นว่ามี token หรือไม่ — การตรวจสิทธิ์จริงทำที่ Laravel ทุก request */
export function proxy(request: NextRequest) {
  const hasToken = request.cookies.has(TOKEN_COOKIE);
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!hasToken && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasToken && isLoginPage && !request.nextUrl.searchParams.has("expired")) {
    return NextResponse.redirect(new URL("/tickets", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
