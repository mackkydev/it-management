/**
 * ลิงก์ iCal ส่วนตัว (/ical/{token}.ics) — ส่งต่อจาก API แบบไม่ต้อง login (token ใน URL ระบุตัวผู้ใช้)
 * ให้ Outlook / Google Calendar สมัครรับ (Subscribe from URL) ผ่านโดเมนเดียวกับหน้าเว็บ
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8020/api/v1";

export async function GET(_req: Request, ctx: RouteContext<"/ical/[token]">) {
  const { token } = await ctx.params;
  const clean = token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9]{32,64}$/.test(clean)) return new Response("Not found", { status: 404 });
  const upstream = await fetch(`${API_URL}/calendar/feed/${clean}`, { cache: "no-store" });
  if (!upstream.ok) return new Response("Not found", { status: 404 });
  return new Response(await upstream.text(), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'inline; filename="it-system.ics"' },
  });
}
