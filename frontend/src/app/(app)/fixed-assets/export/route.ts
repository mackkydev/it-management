import { getI18n } from "@/i18n/server";
import { apiFile } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";

const FILTER_KEYS = ["tab", "search", "site", "fa_class", "fa_dept", "status", "link"] as const;

/**
 * GET /fixed-assets/export?ตัวกรองเดียวกับหน้ารายการ → Excel จาก API (POST /fixed-assets/export)
 * หัวคอลัมน์แปลที่นี่แล้วส่งไปพร้อมคำขอ (เหมือน audit-logs/export)
 */
export async function GET(req: Request) {
  if (!has(await getCurrentUser(), "fixed_assets.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const { t } = await getI18n();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, (sp.get(k) ?? "").slice(0, 100)]).filter(([, v]) => v));
  const body = {
    ...filters,
    headers: {
      sheet: t("fixedAssets.title"),
      site: t("fixedAssets.col.site"),
      branch: t("fixedAssets.col.branch"),
      recordDate: t("fixedAssets.col.recordDate"),
      fanum: t("fixedAssets.col.fanum"),
      description: t("fixedAssets.col.description"),
      class: t("fixedAssets.col.class"),
      dept: t("fixedAssets.col.dept"),
      status: t("fixedAssets.col.status"),
      endUser: t("fixedAssets.col.endUser"),
      serial: t("fixedAssets.col.serial"),
      mfg: t("fixedAssets.col.mfg"),
      asset: t("fixedAssets.col.asset"),
      asOf: t("fixedAssets.col.asOf"),
    },
  };
  const upstream = await apiFile("/fixed-assets/export", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
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
