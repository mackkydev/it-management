import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocumentLink } from "@/components/document-viewer";
import { BuildingIcon, FileTextIcon, MapPinIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card, table } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import type { TFunction } from "@/i18n/types";
import { apiFetch } from "@/lib/api";
import { getAccess, getCurrentUser, has } from "@/lib/auth";
import type { Vendor } from "@/lib/types";
import { VendorButton } from "./vendor-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vendors.title") };
}

const linkCls = "inline-flex max-w-full cursor-pointer items-center gap-1 text-xs font-medium text-accent-700 hover:underline dark:text-accent-300";

/** ลิงก์แผนที่ + ไฟล์เอกสารบริษัท */
function VendorLinks({ v, t }: { v: Vendor; t: TFunction }) {
  if (!v.map_url && v.files.length === 0) return null;
  return (
    <span className="mt-1 flex flex-col items-start gap-0.5">
      {v.map_url && (
        <a href={v.map_url} target="_blank" rel="noreferrer" className={linkCls}>
          <MapPinIcon width={12} height={12} className="shrink-0" />
          {t("vendors.openMap")}
        </a>
      )}
      {v.files.map((f) => (
        <DocumentLink key={f.id} href={`/files${f.url}`} name={f.name} className={linkCls}>
          <FileTextIcon width={12} height={12} className="shrink-0" />
          <span className="truncate">{f.name}</span>
        </DocumentLink>
      ))}
    </span>
  );
}

/** ข้อมูลหลัก → Vendor (vendors.manage) — ใช้เลือกตอนส่งซ่อม, เพิ่ม/แก้ไขในกล่อง */
export default async function VendorsPage() {
  const [user, { t }, can] = await Promise.all([getCurrentUser(), getI18n(), getAccess()]);
  if (!has(user, "vendors.manage")) redirect("/dashboard");
  const [{ data }, typeOptions] = await Promise.all([apiFetch<{ data: Vendor[] }>("/vendors"), apiFetch<{ data: { name: string }[] }>("/dropdown-options/vendor_type")]);
  const types = typeOptions.data.map((o) => o.name);
  const canEdit = can("btn:vendors:create");

  return (
    <div className="space-y-5">
      <PageHeader icon={BuildingIcon} title={t("vendors.title")} subtitle={t("vendors.subtitle")} actions={canEdit && <VendorButton types={types} />} />

      {data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("vendors.empty")}</div>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {data.map((v) => (
              <li key={v.id} className={`space-y-1 p-4 ${card} ${v.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{v.name}</span>
                  {canEdit && <VendorButton vendor={v} types={types} />}
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
                <VendorLinks v={v} t={t} />
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
                    <td className={`${table.td} min-w-48 max-w-md text-xs text-muted`}>
                      <span className="whitespace-pre-line">{v.address}</span>
                      <VendorLinks v={v} t={t} />
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-right`}>{canEdit && <VendorButton vendor={v} types={types} />}</td>
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
