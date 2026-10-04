import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { btn } from "@/components/ui";
import { getI18n } from "@/i18n/server";

interface Meta {
  current_page: number;
  last_page?: number;
  from: number | null;
  to: number | null;
  total?: number;
}

/** แถบเปลี่ยนหน้า — รองรับทั้ง paginate (มี total) และ simplePaginate (มีแค่ next) */
export async function Pagination({
  meta,
  href,
  hasNext,
}: {
  meta: Meta;
  href: (page: number) => string;
  hasNext?: boolean;
}) {
  const { t, fmt } = await getI18n();
  const last = meta.last_page;
  const canNext = hasNext ?? (last !== undefined && meta.current_page < last);
  if (meta.current_page <= 1 && !canNext) return null;

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pagination">
      <span className="text-muted">
        {meta.total !== undefined && meta.from !== null
          ? t("common.range", { from: fmt.number(meta.from), to: fmt.number(meta.to ?? 0), total: fmt.number(meta.total) })
          : null}
      </span>
      <div className="flex items-center gap-2">
        {meta.current_page > 1 && (
          <Link href={href(meta.current_page - 1)} className={`${btn.secondary} ${btn.sm}`}>
            <LinkPendingIcon icon={<ChevronLeftIcon width={14} height={14} className="text-accent-400" />} size={14} />
            {t("common.previous")}
          </Link>
        )}
        {last !== undefined && (
          <span className="px-2 text-muted">{t("common.page", { current: meta.current_page, last })}</span>
        )}
        {canNext && (
          <Link href={href(meta.current_page + 1)} className={`${btn.secondary} ${btn.sm}`}>
            {t("common.next")}
            <LinkPendingIcon icon={<ChevronRightIcon width={14} height={14} className="text-accent-400" />} size={14} />
          </Link>
        )}
      </div>
    </nav>
  );
}
