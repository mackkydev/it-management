import { apiFile } from "@/lib/api";

/**
 * ส่งต่อไฟล์ส่วนตัว (รูป/เอกสาร/ลายเซ็น) จาก API ไปที่ browser พร้อม token ใน cookie
 *   <img src="/files/tickets/{uuid}/files/attachment/12">
 *   <img src="/files/auth/me/signature?v=...">   (ลายเซ็นในโปรไฟล์ของตัวเอง — ?v= ใช้แค่ให้ cache ใหม่)
 *   <img src="/files/branding/logo?v=...">   (โลโก้ระบบในเมนู — ?v= ใช้แค่ให้ cache ใหม่)
 *   <a href="/files/assets/{uuid}/files/3?download=1">   (ไฟล์ license ของสินทรัพย์ — ?download=1 บังคับดาวน์โหลด)
 *   <a href="/files/assets/import-template">   (template Excel สำหรับนำเข้าทะเบียนคอมพิวเตอร์)
 *   <a href="/files/kpi/export?from=2025-10&to=2025-12&user_id=3">   (KPI ฝ่าย IT เป็น Excel — ส่งต่อเฉพาะ from/to/user_id ที่ผ่านรูปแบบ)
 * อนุญาตเฉพาะ path ของไฟล์ — กันไม่ให้ใช้เป็น proxy เรียก API อื่น
 */
const ALLOWED =
  /^(tickets\/[0-9a-f-]{36}\/files\/(attachment|part|requester-signature|staff-signature|it-head-signature)(\/\d+)?|auth\/me\/signature|branding\/logo|assets\/import-template|kpi\/export|assets\/[0-9a-f-]{36}\/files\/\d+)$/i;

export async function GET(req: Request, ctx: RouteContext<"/files/[...path]">) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED.test(joined)) {
    return new Response("Not found", { status: 404 });
  }

  // ส่งต่อเฉพาะ ?download=1 (ไม่ส่ง query อื่นไป API) — ยกเว้น KPI export: from/to (YYYY-MM) + user_id (ตัวเลข)
  const sp = new URL(req.url).searchParams;
  let query = sp.has("download") ? "?download=1" : "";
  if (joined === "kpi/export") {
    const q = new URLSearchParams();
    for (const k of ["from", "to"]) if (/^\d{4}-\d{2}$/.test(sp.get(k) ?? "")) q.set(k, sp.get(k)!);
    if (/^\d+$/.test(sp.get("user_id") ?? "")) q.set("user_id", sp.get("user_id")!);
    query = `?${q}`;
  }
  const upstream = await apiFile(`/${joined}${query}`);
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.status === 403 ? "Forbidden" : "Not found", { status: upstream.status === 403 ? 403 : 404 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    // KPI export สร้างจากข้อมูลล่าสุดทุกครั้ง — ห้าม cache
    "Cache-Control": joined === "kpi/export" ? "no-store" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return new Response(upstream.body, { status: 200, headers });
}
