import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GitBranchIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LinkPendingIcon } from "@/components/pending";
import { btn, card, tone } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, isLocalAdmin } from "@/lib/auth";
import type { ApiConnection } from "@/lib/types";
import { ConnectionGuide } from "./connection-guide";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("apiConnections.title") };
}

/** ตั้งค่าระบบ → การเชื่อมต่อ API (Local Admin) */
export default async function ApiConnectionsPage() {
  if (!isLocalAdmin(await getCurrentUser())) redirect("/tickets");
  const [{ t, fmt }, { data }] = await Promise.all([getI18n(), apiFetch<{ data: ApiConnection[] }>("/api-connections")]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={GitBranchIcon}
        title={t("apiConnections.title")}
        subtitle={t("apiConnections.subtitle")}
        actions={
          <Link href="/api-connections/new" className={btn.primary}>
            <LinkPendingIcon icon={<PlusIcon />} />
            {t("apiConnections.add")}
          </Link>
        }
      />
      {/* วิธีเชื่อมต่อ STEC SyteLine API — เปิดไว้เมื่อยังไม่มีการเชื่อมต่อ */}
      <ConnectionGuide />
      {data.length === 0 ? (
        <div className={`p-10 text-center text-muted ${card}`}>{t("apiConnections.empty")}</div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((c) => (
            <li key={c.id} className={`flex flex-col gap-3 p-5 ${card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{c.name}</p>
                  <p className="truncate text-sm text-muted">{c.base_url}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.is_enabled ? tone.success.badge : tone.idle.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${c.is_enabled ? tone.success.dot : tone.idle.dot}`} aria-hidden="true" />
                  {c.is_enabled ? t("apiConnections.enabled") : t("apiConnections.disabled")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-muted">
                <span>
                  {t("apiConnections.usersCount", { count: fmt.number(c.users_count) })} · {t(`apiConnections.authTypes.${c.auth_type}`)}
                </span>
                <Link href={`/api-connections/${c.id}`} className={`${btn.soft} ${btn.sm}`}>
                  <LinkPendingIcon icon={<PencilIcon width={13} height={13} />} size={13} />
                  {t("common.edit")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
