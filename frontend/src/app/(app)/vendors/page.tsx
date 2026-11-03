import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BuildingIcon, CheckCircleIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { alert, btn, card, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { Vendor } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vendors.title") };
}

const SAVED = ["created", "updated", "deleted"] as const;

/** ข้อมูลหลัก → Vendor (vendors.manage) — ใช้เลือกตอนส่งซ่อม */
export default async function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  const [params, user, { t }, can] = await Promise.all([searchParams, getCurrentUser(), getI18n(), getAccess()]);
  if (!has(user, "vendors.manage")) redirect("/dashboard");
  const { data } = await apiFetch<{ data: Vendor[] }>("/vendors");
  const saved = SAVED.find((s) => s === params.saved);
  const canEdit = can("btn:vendors:create");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BuildingIcon}
        title={t("vendors.title")}
        subtitle={t("vendors.subtitle")}
        actions={
          canEdit && (
            <Link href="/vendors/new" className={btn.primary}>
              <LinkPendingIcon icon={<PlusIcon />} />
              {t("vendors.add")}
            </Link>
          )
        }
      />

      {saved && (
        <div role="status" className={alert.success}>
          <CheckCircleIcon className="shrink-0 text-success-500" />
          {t(`vendors.saved.${saved}`)}
        </div>
      )}

      {data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vendors.empty")}</div>
      ) : (
        <>
        <ul className="space-y-3 lg:hidden">
          {data.map((v) => (
            <li key={v.id} className={`space-y-1 p-4 ${card} ${v.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{v.name}</span>
                {canEdit && (
                  <Link href={`/vendors/${v.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                    <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                    {t("common.edit")}
                  </Link>
                )}
              </div>
              <p className="text-xs text-muted">
                {v.vendor_type}
                {v.is_active ? "" : ` · ${t("vendors.inactive")}`}
                {v.tax_id ? ` · ${v.tax_id}` : ""}
              </p>
              <p className="text-sm">
                {v.contact_name} · {v.contact_phone}
              </p>
              <p className="whitespace-pre-line text-xs text-muted">{v.address}</p>
            </li>
          ))}
        </ul>
        <div className={`hidden lg:block ${table.wrap}`}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>{t("vendors.col.name")}</th>
                <th className={table.th}>{t("vendors.col.type")}</th>
                <th className={table.th}>{t("vendors.col.taxId")}</th>
                <th className={table.th}>{t("vendors.col.contact")}</th>
                <th className={table.th}>{t("vendors.col.address")}</th>
                <th className={table.th} aria-label={t("common.manage")} />
              </tr>
            </thead>
            <tbody className={table.body}>
              {data.map((v) => (
                <tr key={v.id} className={`${table.row} ${v.is_active ? "" : "opacity-60"}`}>
                  <td className={table.td}>
                    <span className="font-medium">{v.name}</span>
                    {!v.is_active && <span className="ml-2 whitespace-nowrap rounded-full bg-subtle px-2 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">{t("vendors.inactive")}</span>}
                  </td>
                  <td className={`${table.td} whitespace-nowrap text-muted`}>{v.vendor_type}</td>
                  <td className={`${table.td} whitespace-nowrap text-muted`}>{v.tax_id ?? "—"}</td>
                  <td className={`${table.td} whitespace-nowrap`}>
                    {v.contact_name}
                    <span className="block text-xs text-muted">{v.contact_phone}</span>
                  </td>
                  <td className={`${table.td} min-w-48 whitespace-pre-line text-xs text-muted`}>{v.address}</td>
                  <td className={`${table.td} whitespace-nowrap text-right`}>
                    {canEdit && (
                      <Link href={`/vendors/${v.id}/edit`} className={`${btn.soft} ${btn.sm}`}>
                        <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                        {t("common.edit")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
