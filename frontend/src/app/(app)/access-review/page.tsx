import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { AccessException, GroupMembersView } from "@/lib/types";
import { ExceptionsTable } from "./exceptions-table";
import { GroupMembers } from "./group-members";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("accessReview.title") };
}

type Group = { key: string; name_th: string; name_en: string; is_system: boolean; members: number };

const TAB_CLS = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;

/**
 * ตรวจสอบสิทธิ์ (access.assign): แท็บ "สมาชิกกลุ่ม" (เพิ่ม/แก้วันหมดอายุ/เอาออกจากหน้ากลุ่ม)
 * และ "สิทธิ์รายคนพิเศษ" (ทุกการมอบที่ไม่ได้มาจากตำแหน่ง — ยกเลิกได้จากหน้านี้)
 */
export default async function AccessReviewPage({ searchParams }: PageProps<"/access-review">) {
  const user = await getCurrentUser();
  if (!has(user, "access.assign")) redirect("/tickets");
  const sp = await searchParams;
  const tab = sp.tab === "exceptions" ? "exceptions" : "groups";
  const { t } = await getI18n();

  let body: React.ReactNode;
  if (tab === "groups") {
    // super_admin ผ่านทุกสิทธิ์ — ไม่มีสมาชิกให้จัดการ
    const groups = (await apiFetch<{ groups: Group[] }>("/permissions")).groups.filter((g) => g.key !== "super_admin");
    const wanted = typeof sp.group === "string" ? sp.group : "";
    const key = groups.find((g) => g.key === wanted)?.key ?? groups.find((g) => !g.is_system)?.key ?? groups[0]?.key;
    body = key ? (
      <GroupMembers groups={groups} view={(await apiFetch<{ data: GroupMembersView }>(`/permission-groups/${encodeURIComponent(key)}/members`)).data} />
    ) : (
      <p className="text-sm text-muted">{t("accessReview.members.noGroups")}</p>
    );
  } else {
    const res = await apiFetch<{ data: AccessException[]; expiry_enabled: boolean }>("/access-exceptions");
    body = <ExceptionsTable items={res.data} expiryEnabled={res.expiry_enabled} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldIcon} title={t("accessReview.title")} subtitle={t("accessReview.subtitle")} />
      <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1 sm:inline-flex">
        {(["groups", "exceptions"] as const).map((x) => (
          <Link key={x} role="tab" aria-selected={tab === x} href={`/access-review?tab=${x}`} className={TAB_CLS(tab === x)}>
            {t(`accessReview.tabs.${x}`)}
          </Link>
        ))}
      </div>
      {body}
    </div>
  );
}
