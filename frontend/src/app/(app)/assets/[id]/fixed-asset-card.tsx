import Link from "next/link";
import { DatabaseIcon } from "@/components/icons";
import { card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import type { FixedAsset } from "@/lib/types";

const STATUS_TONE: Record<string, string> = { Active: tone.success.badge, Disposed: tone.idle.badge, Inactive: tone.warning.badge };

/**
 * การ์ด "ข้อมูลบัญชีจาก SyteLine" ในหน้ารายละเอียดสินทรัพย์ (fixed_assets.view) — Fixed Assets ที่ผูกกับเครื่องนี้ (อาจมีหลายรายการ)
 * ไม่ได้ผูก / โหลดไม่ได้ = ไม่แสดงอะไร
 */
export async function FixedAssetCard({ assetId }: { assetId: string }) {
  const [{ t, fmt }, rows] = await Promise.all([
    getI18n(),
    apiFetch<{ data: FixedAsset[] }>(`/fixed-assets/by-asset/${assetId}`)
      .then((r) => r.data)
      .catch(() => [] as FixedAsset[]),
  ]);
  if (rows.length === 0) return null;

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
              <DatabaseIcon width={15} height={15} />
            </span>
            {t("fixedAssets.card.title")}
          </h2>
          <p className="mt-1 text-xs text-muted">{t("fixedAssets.card.hint", { date: fmt.date(rows[0].as_of) })}</p>
        </div>
        <Link href={`/fixed-assets?search=${encodeURIComponent(rows[0].fanum)}`} className="cursor-pointer text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">
          {t("fixedAssets.card.openList")}
        </Link>
      </div>
      {rows.map((fa) => (
        <div key={fa.id} className="space-y-3 border-t border-line pt-3 first-of-type:border-t-0 first-of-type:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-accent-700 dark:text-accent-300">{fa.fanum}</span>
            <span className="text-sm">{fa.description}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[fa.fa_status ?? ""] ?? tone.idle.badge}`}>
              {fa.fa_status ? t(`fixedAssets.statuses.${fa.fa_status}` as MessageKey) : "—"}
            </span>
            {fa.missing_since && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{t("fixedAssets.missingSince", { date: fmt.date(fa.missing_since) })}</span>}
          </div>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">{t("fixedAssets.col.classDept")}</dt>
              <dd className="mt-0.5 font-medium">
                {fa.fa_class}-{fa.fa_dept}
                {fa.class_dept_desc && <span className="block text-xs font-normal text-muted">{fa.class_dept_desc}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("fixedAssets.col.endUser")}</dt>
              <dd className="mt-0.5 break-words font-medium">{fa.end_user || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("fixedAssets.col.serial")}</dt>
              <dd className="mt-0.5 break-all font-mono text-xs font-medium">{fa.serial || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("fixedAssets.col.mfg")}</dt>
              <dd className="mt-0.5 break-all font-medium">{fa.mfg || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("fixedAssets.col.recordDate")}</dt>
              <dd className="mt-0.5 font-medium">{fa.record_date ? fmt.date(fa.record_date) : "—"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </section>
  );
}
