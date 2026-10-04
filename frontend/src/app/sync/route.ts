import { createHash } from "node:crypto";
import { apiFile } from "@/lib/api";

/**
 * GET /sync            → ลายนิ้วมือข้อมูลทั้งระบบของผู้ใช้ (API GET /sync/version)
 * GET /sync?scope=public → ลายนิ้วมือประกาศบนหน้า login (API GET /announcements/public — ไม่ต้อง login)
 * ใช้โดย <LiveRefresh> — เป็น route handler (ไม่ใช่ server action) เพื่อไม่ให้การถามซ้ำ ๆ ไปต่อคิวกับ action อื่น
 * ตอบ { version } หรือ 204 ถ้าตรวจไม่ได้ (เช่น token หมดอายุ) — ผู้เรียกจะข้ามรอบนั้นไป
 */
export async function GET(req: Request) {
  const isPublic = new URL(req.url).searchParams.get("scope") === "public";
  try {
    const res = await apiFile(isPublic ? "/announcements/public" : "/sync/version");
    if (!res.ok) return new Response(null, { status: 204 });
    const body = await res.json();
    const version = isPublic ? createHash("md5").update(JSON.stringify(body.data ?? [])).digest("hex") : String(body.data?.version ?? "");
    return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 204 });
  }
}
