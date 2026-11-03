import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClickableRow } from "@/components/clickable-row";
import { KeyIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn, card, table, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { canCreateAssets, canViewAssets, canViewLicenses, getAccess, getCurrentUser } from "@/lib/auth";
import type { LicenseSummary } from "@/lib/types";
import { UsageBar } from "../../license-installations/usage-bar";
import { groupUsage, licenseGroupKey } from "../license-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("licenses.title") };
}

/** License ชื่อเดียวกัน แถวละ 1 รายการ (กล่องละ S/N) + เครื่องที่ติดตั้ง — คลิกชื่อเครื่องไปหน้าสินทรัพย์นั้น */
export default async function LicenseGroupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, can, params] = await Promise.all([getCurrentUser(), getAccess(), searchParams]);
  if (!canViewLicenses(user)) redirect("/dashboard");
  const name = typeof params.name === "string" ? params.name.slice(0, 255) : "";
  const [{ t, fmt }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: LicenseSummary[] }>("/licenses")]);
  const items = data.filter((l) => licenseGroupKey(l.name) === licenseGroupKey(name));
  if (items.length === 0) redirect("/licenses");
  // เหลือใบเดียว (เช่น เปลี่ยนชื่อ / ลบใบอื่นแล้ว) = ไปหน้ารายละเอียดเลย
  if (items.length === 1) redirect(`/licenses/${items[0].id}`);

  const [first] = items;
  const showAssets = canViewAssets(user);
  const canCreate = canCreateAssets(user) && can("btn:licenses:create");
  const addHref = `/licenses/new?${new URLSearchParams({ type: first.software_type, name: first.name.slice(0, 255) })}` as Route;

  const devices = (l: LicenseSummary) =>
    l.devices.length === 0 ? (
      <span className="text-faint">{t("licenses.group.notInstalled")}</span>
    ) : (
      <span className="flex flex-col gap-0.5">
        {l.devices.map((d, i) => {
          const label = (
            <>
              {d.asset_tag && <span className="font-mono text-xs">{d.asset_tag}</span>}
              {d.name && <span className="ml-1.5">{d.name}</span>}
            </>
          );
          return d.id && showAssets ? (
            <Link key={i} href={`/assets/${d.id}`} className="cursor-pointer text-accent-700 hover:underline dark:text-accent-300">
              {label}
            </Link>
          ) : (
            <span key={i}>{label}</span>
          );
        })}
      </span>
    );
  const expiry = (l: LicenseSummary) =>
    !l.expires_at ? (
      t("assets.license.noExpiry")
    ) : l.expiring ? (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.warning.badge}`}>{fmt.date(l.expires_at)}</span>
    ) : (
      fmt.date(l.expires_at)
    );
  const seats = (l: LicenseSummary) => (l.seats === null ? t("licenses.group.unlimited") : `${fmt.number(l.used)} / ${fmt.number(l.seats)}`);
  const tag = (l: LicenseSummary) => (
    <Link href={`/licenses/${l.id}`} className="cursor-pointer font-mono text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">
      {l.license_no ?? "-"}
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={KeyIcon}
        title={first.name}
        subtitle={`${t(`licenses.types.${first.software_type}`)} · ${t("licenses.group.count", { count: fmt.number(items.length) })}`}
        actions={
          canCreate && (
            <Link href={addHref} className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("licenses.group.add")}
            </Link>
          )
        }
      />
      <section className={`p-4 sm:p-5 ${card}`}>
        <UsageBar usage={groupUsage(items)} t={t} fmt={fmt} />
      </section>

      <div className={`hidden md:block ${table.wrap}`}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              <th className={table.th}>#</th>
              <th className={table.th}>{t("assets.form.tag")}</th>
              <th className={table.th}>{t("assets.form.serial")}</th>
              <th className={table.th}>{t("licenses.group.expires")}</th>
              <th className={table.th}>{t("licenses.group.seats")}</th>
              <th className={table.th}>{t("licenses.group.devices")}</th>
            </tr>
          </thead>
          <tbody className={table.body}>
            {items.map((l, i) => (
              <ClickableRow key={l.id} href={`/licenses/${l.id}`} className={`${table.row} align-top`}>
                <td className={`${table.td} tabular-nums text-muted`}>{fmt.number(i + 1)}</td>
                <td className={table.td}>{tag(l)}</td>
                <td className={`${table.td} font-mono text-sm`}>{l.serial_number ?? "-"}</td>
                <td className={`${table.td} whitespace-nowrap`}>{expiry(l)}</td>
                <td className={`${table.td} whitespace-nowrap tabular-nums`}>{seats(l)}</td>
                <td className={table.td}>{devices(l)}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
        {items.map((l) => (
          <ClickableRow key={l.id} as="li" href={`/licenses/${l.id}`} className={`space-y-2 p-4 text-sm ${card}`}>
            <p>{tag(l)}</p>
            <p className="text-muted">
              {t("assets.form.serial")}: <span className="font-mono text-ink">{l.serial_number ?? "-"}</span>
            </p>
            <p className="text-muted">
              {t("licenses.group.expires")}: <span className="text-ink">{expiry(l)}</span> · {seats(l)}
            </p>
            <div>
              <p className="text-xs text-muted">{t("licenses.group.devices")}</p>
              {devices(l)}
            </div>
          </ClickableRow>
        ))}
      </ul>
    </div>
  );
}
