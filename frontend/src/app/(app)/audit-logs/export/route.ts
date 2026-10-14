import { getI18n } from "@/i18n/server";
import { apiFetch, apiFile } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import { getPrefs } from "@/lib/prefs-server";
import { actionLabel, auditQuery } from "../labels";

/**
 * GET /audit-logs/export?ตัวกรองเดียวกับหน้ารายการ → Excel จาก API (POST /audit-logs/export)
 * ชื่อการกระทำ / หัวคอลัมน์แปลที่นี่ (พจนานุกรมอยู่ฝั่งเว็บ) แล้วส่งไปพร้อมคำขอ
 */
export async function GET(req: Request) {
  if (!has(await getCurrentUser(), "audit_logs.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const [{ t }, actions] = await Promise.all([getI18n(), apiFetch<{ data: string[] }>("/audit-logs/actions").then((r) => r.data)]);
  const filters = Object.fromEntries(auditQuery((k) => (sp.get(k) ?? "").slice(0, 100), actions));
  const body = {
    ...filters,
    labels: Object.fromEntries(actions.map((a) => [a, actionLabel(t, a)])),
    headers: {
      sheet: t("audit.title"),
      time: t("audit.col.time"),
      actor: t("audit.col.actor"),
      branch: t("audit.col.branch"),
      action: t("audit.col.action"),
      subject: t("audit.col.subject"),
      changes: t("audit.changes"),
      system: t("audit.system"),
    },
  };
  // ภาษาของวันที่ในไฟล์ตามที่ผู้ใช้เลือก
  const { locale } = await getPrefs();
  const upstream = await apiFile("/audit-logs/export", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "Accept-Language": locale } });
  if (!upstream.ok || !upstream.body) return new Response(upstream.status === 403 ? "Forbidden" : "Export failed", { status: upstream.status === 403 ? 403 : 500 });
  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(upstream.body, { status: 200, headers });
}
