import { apiFile } from "@/lib/api";

/**
 * ส่งต่อไฟล์ส่วนตัว (รูป/เอกสาร/ลายเซ็น) จาก API ไปที่ browser พร้อม token ใน cookie
 *   <img src="/files/tickets/{uuid}/files/attachment/12">
 *   <img src="/files/auth/me/signature?v=...">   (ลายเซ็นในโปรไฟล์ของตัวเอง — ?v= ใช้แค่ให้ cache ใหม่)
 * อนุญาตเฉพาะ path ของไฟล์ — กันไม่ให้ใช้เป็น proxy เรียก API อื่น
 */
const ALLOWED =
  /^(tickets\/[0-9a-f-]{36}\/files\/(attachment|part|requester-signature|staff-signature|it-head-signature)(\/\d+)?|auth\/me\/signature)$/i;

export async function GET(_req: Request, ctx: RouteContext<"/files/[...path]">) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED.test(joined)) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = await apiFile(`/${joined}`);
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
