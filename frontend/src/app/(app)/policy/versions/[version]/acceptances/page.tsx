import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { getCurrentUser, has } from "@/lib/auth";
import type { PolicyAcceptanceList } from "@/lib/types";
import { AcceptanceList } from "./acceptance-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("policyPage.acceptances") };
}

/** รายชื่อผู้ยอมรับนโยบายฉบับหนึ่ง + พิมพ์รายชื่อ */
export default async function PolicyAcceptancesPage({ params }: PageProps<"/policy/versions/[version]/acceptances">) {
  const { version } = await params;
  if (!/^\d+$/.test(version)) notFound();
  if (!has(await getCurrentUser(), "policy.manage")) redirect("/policy");
  const { t } = await getI18n();
  const list = await apiFetch<PolicyAcceptanceList>(`/policy/versions/${version}/acceptances`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  return (
    <div className="space-y-5">
      <PageHeader icon={UsersIcon} title={t("policyPage.acceptances")} subtitle={t("policyPage.versionOf", { title: list.title, version: list.version })} />
      <AcceptanceList list={list} />
    </div>
  );
}
