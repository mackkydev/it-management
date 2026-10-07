"use client";

import { useEffect, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { BoxIcon, ChartIcon, ClipboardIcon, FileTextIcon, HistoryIcon, InfoIcon, KeyIcon, SparklesIcon, UsersIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";
import { APP_VERSION, CHANGELOG, compareVersions, markVersionSeen, readPrevSeenVersion, subscribeSeenVersion, type ChangeType } from "@/lib/changelog";

const MODULES: { icon: ComponentType<SVGProps<SVGSVGElement>>; key: string }[] = [
  { icon: ClipboardIcon, key: "tickets" },
  { icon: BoxIcon, key: "assets" },
  { icon: KeyIcon, key: "vault" },
  { icon: FileTextIcon, key: "contracts" },
  { icon: ChartIcon, key: "kpi" },
  { icon: UsersIcon, key: "users" },
];

const TYPE_STYLE: Record<ChangeType, string> = {
  new: "bg-success-100 text-success-800 dark:bg-success-400/15 dark:text-success-300",
  improved: "bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300",
  fixed: "bg-warning-100 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300",
  security: "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-300",
};

export function AboutView() {
  const { t, fmt, locale } = useI18n();
  // เปิดหน้านี้ = รับทราบเวอร์ชันปัจจุบันแล้ว (ป้าย "ใหม่" ที่โลโก้หายไป)
  useEffect(() => markVersionSeen(), []);
  // เวอร์ชันที่ใช้อยู่ก่อนอัปเดต → ติดป้าย "ใหม่" ให้ release ที่เพิ่งได้รับ (ไม่มีค่า = ผู้ใช้ใหม่/ยังไม่เคยอัปเดต → ไม่ติดป้าย)
  const prev = useSyncExternalStore(subscribeSeenVersion, readPrevSeenVersion, () => undefined);
  const isUnseen = (version: string) => Boolean(prev) && compareVersions(prev!, version) < 0;
  const latest = CHANGELOG[0];
  const text = (c: { th: string; en: string }) => (locale === "en" ? c.en : c.th);

  return (
    <div className="space-y-5">
      <PageHeader icon={InfoIcon} title={t("about.title")} subtitle={t("about.subtitle")} />

      {/* เวอร์ชันปัจจุบัน + รายละเอียดโดยย่อ */}
      <section className={`overflow-hidden ${card}`}>
        <div className="flex flex-wrap items-center gap-4 bg-accent-50 p-5 sm:p-6 dark:bg-accent-400/10">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-200 text-accent-700 dark:bg-accent-400/20 dark:text-accent-300">
            <SparklesIcon width={28} height={28} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{t("app.fullName")}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="rounded-full bg-accent-500 px-2.5 py-0.5 text-xs font-semibold text-white">v{APP_VERSION}</span>
              {t("about.releasedOn", { date: fmt.date(latest.date) })}
              {isUnseen(latest.version) && (
                <span className="rounded-full bg-danger-100 px-2 py-0.5 text-xs font-semibold text-danger-700 dark:bg-danger-400/15 dark:text-danger-300">{t("about.newFor")}</span>
              )}
            </p>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-sm leading-relaxed">{t("about.description")}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {(["version", "stack", "owner"] as const).map((k) => (
              <div key={k} className="rounded-xl bg-subtle/60 p-3">
                <dt className="text-xs text-muted">{t(`about.info.${k}` as MessageKey)}</dt>
                <dd className="mt-0.5 font-medium">{k === "version" ? `v${APP_VERSION}` : t(`about.info.${k}Value` as MessageKey)}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("about.modulesTitle")}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map(({ icon: Icon, key }) => (
                <li key={key} className="flex gap-2.5 rounded-xl p-3 ring-1 ring-line">
                  <Icon width={17} height={17} className="mt-0.5 shrink-0 text-accent-500" />
                  <span>
                    <span className="block text-sm font-medium">{t(`about.modules.${key}.name` as MessageKey)}</span>
                    <span className="block text-xs text-muted">{t(`about.modules.${key}.desc` as MessageKey)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ประวัติการอัปเดต — ใหม่สุดอยู่บน */}
      <section className={`p-5 sm:p-6 ${card}`}>
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <HistoryIcon width={17} height={17} className="text-accent-500" />
          {t("about.changelogTitle")}
        </h2>
        <ol className="relative space-y-6 border-l border-line pl-6">
          {CHANGELOG.map((r, i) => (
            <li key={r.version} className="relative">
              <span
                className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-surface ${i === 0 ? "bg-accent-500" : "bg-line"}`}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">v{r.version}</h3>
                <span className="text-xs text-muted">{fmt.date(r.date)}</span>
                {i === 0 && <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">{t("about.latest")}</span>}
                {isUnseen(r.version) && (
                  <span className="rounded-full bg-danger-100 px-2 py-0.5 text-xs font-semibold text-danger-700 dark:bg-danger-400/15 dark:text-danger-300">{t("about.newFor")}</span>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {r.changes.map((c, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium ${TYPE_STYLE[c.type]}`}>{t(`about.type.${c.type}`)}</span>
                    <span>{text(c)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
