import type { Metadata } from "next";
import Link from "next/link";
import { BoxIcon, CheckCircleIcon, MapPinIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { alert, btn, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, canManageAssets, getCurrentUser } from "@/lib/auth";
import { LOCATION_TYPES, type Location, type LocationType } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("locations.title") };
}

/** ประเภทสถานที่ใช้ความเข้มของสีธีมไล่ตามลำดับชั้น (ไม่ใช้สีสถานะของระบบ เพื่อไม่ให้สับสน) */
const TYPE_STYLE: Record<string, string> = {
  site: "bg-accent-300 text-accent-900 dark:bg-accent-400/35 dark:text-accent-100",
  building: "bg-accent-200 text-accent-800 dark:bg-accent-400/25 dark:text-accent-200",
  floor: "bg-accent-100 text-accent-700 dark:bg-accent-400/15 dark:text-accent-300",
  room: "bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200 dark:bg-transparent dark:text-accent-300 dark:ring-accent-400/30",
  warehouse: "bg-surface text-muted ring-1 ring-inset ring-line",
};

const SAVED = ["created", "updated", "deleted"] as const;

/** เรียงสถานที่เป็นลำดับชั้น (สาขา > อาคาร > ชั้น > ห้อง) พร้อมระดับความลึกสำหรับเยื้อง */
function toTree(list: Location[]): { loc: Location; depth: number }[] {
  const children = new Map<number | null, Location[]>();
  const ids = new Set(list.map((l) => l.id));
  for (const l of list) {
    const parent = l.parent_id !== null && ids.has(l.parent_id) ? l.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), l]);
  }
  const out: { loc: Location; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const loc of (children.get(parent) ?? []).sort((a, b) => a.code.localeCompare(b.code))) {
      out.push({ loc, depth });
      walk(loc.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default async function LocationsPage({ searchParams }: PageProps<"/locations">) {
  const [params, user, { t, fmt }, can] = await Promise.all([searchParams, getCurrentUser(), getI18n(), getAccess()]);
  const canManage = canManageAssets(user);
  const canCreate = canManage && can("btn:locations:create");
  // ผู้จัดการเห็นทั้งหมด (รวมที่ปิดใช้งาน) พร้อมจำนวนสินทรัพย์/สถานที่ย่อย
  const { data } = await apiFetch<{ data: Location[] }>(canManage ? "/locations?include_inactive=1" : "/locations");
  const rows = toTree(data);
  const saved = SAVED.find((s) => s === params.saved);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MapPinIcon}
        title={t("locations.title")}
        subtitle={t("locations.subtitle")}
        actions={
          canCreate && (
            <Link href="/locations/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("locations.add")}
            </Link>
          )
        }
      />

      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`locations.saved.${saved}`)}
        </div>
      )}

      <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>{t("locations.col.name")}</th>
              <th className={table.th}>{t("locations.col.code")}</th>
              <th className={table.th}>{t("locations.col.type")}</th>
              {canManage && <th className={table.th}>{t("locations.col.usage")}</th>}
              <th className={table.th} aria-label={t("common.manage")} />
            </tr>
          </thead>
          <tbody className={table.body}>
            {rows.map(({ loc, depth }) => (
              <tr key={loc.id} className={`${table.row} ${loc.is_active === false ? "opacity-60" : ""}`}>
                <td className={table.td}>
                  <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                    {depth > 0 && (
                      <span className="text-faint" aria-hidden="true">
                        └
                      </span>
                    )}
                    <span className={depth === 0 ? "font-semibold" : "font-medium"}>{loc.name}</span>
                    {loc.is_active === false && (
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">
                        {t("locations.inactive")}
                      </span>
                    )}
                  </div>
                </td>
                <td className={`${table.td} whitespace-nowrap font-mono text-xs text-muted`}>{loc.code}</td>
                <td className={table.td}>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_STYLE[loc.type] ?? TYPE_STYLE.room}`}>
                    {(LOCATION_TYPES as readonly string[]).includes(loc.type) ? t(`locations.types.${loc.type as LocationType}`) : loc.type}
                  </span>
                </td>
                {canManage && (
                  <td className={`${table.td} whitespace-nowrap text-xs text-muted`}>
                    {t("locations.counts", { assets: fmt.number(loc.assets_count ?? 0), children: fmt.number(loc.children_count ?? 0) })}
                  </td>
                )}
                <td className={`${table.td} whitespace-nowrap text-right`}>
                  <div className="flex justify-end gap-2">
                    {(loc.assets_count ?? 1) > 0 && (loc.type === "room" || loc.type === "warehouse") && (
                      <Link href={`/assets?location_id=${loc.id}`} className={`${btn.secondary} ${btn.sm}`}>
                        <LinkPendingIcon icon={<BoxIcon width={13} height={13} className="text-accent-400" />} size={13} />
                        {t("locations.viewAssets")}
                      </Link>
                    )}
                    {canManage && (
                      <Link href={`/locations/${loc.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                        <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                        {t("common.edit")}
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
