import { apiFile } from "@/lib/api";

/**
 * ส่งต่อไฟล์ส่วนตัว (รูป/เอกสาร/ลายเซ็น) จาก API ไปที่ browser พร้อม token ใน cookie
 *   <img src="/files/tickets/{uuid}/files/attachment/12">
 *   <img src="/files/auth/me/signature?v=...">   (ลายเซ็นในโปรไฟล์ของตัวเอง — ?v= ใช้แค่ให้ cache ใหม่)
 *   <img src="/files/branding/logo?v=...">   (โลโก้ระบบในเมนู — ?v= ใช้แค่ให้ cache ใหม่)
 *   <a href="/files/assets/{uuid}/files/3?download=1">   (ไฟล์ license ของสินทรัพย์ — ?download=1 บังคับดาวน์โหลด)
 *   <a href="/files/assets/import-template">   (template Excel สำหรับนำเข้าทะเบียนคอมพิวเตอร์)
 * อนุญาตเฉพาะ path ของไฟล์ — กันไม่ให้ใช้เป็น proxy เรียก API อื่น
 */
const ALLOWED =
  /^(tickets\/[0-9a-f-]{36}\/files\/(attachment|part|requester-signature|staff-signature|it-head-signature)(\/\d+)?|auth\/me\/signature|branding\/logo|assets\/import-template|assets\/[0-9a-f-]{36}\/files\/\d+)$/i;

export async function GET(req: Request, ctx: RouteContext<"/files/[...path]">) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED.test(joined)) {
    return new Response("Not found", { status: 404 });
  }

  // ส่งต่อเฉพาะ ?download=1 (ไม่ส่ง query อื่นไป API)
  const download = new URL(req.url).searchParams.has("download") ? "?download=1" : "";
  const upstream = await apiFile(`/${joined}${download}`);
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.status === 403 ? "Forbidden" : "Not found", { status: upstream.status === 403 ? 403 : 404 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);

  return new Response(upstream.body, { status: 200, headers });
}
