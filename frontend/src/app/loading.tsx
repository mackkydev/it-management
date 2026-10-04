import { SpinnerIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

/** แสดงระหว่างตรวจสอบผู้ใช้ (layout ของหน้าหลักต้องเรียก /auth/me ก่อน) */
export default async function Loading() {
  const { t } = await getI18n();
  return (
    <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-3 text-accent-600 dark:text-accent-300">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-100 dark:bg-accent-400/15">
        <SpinnerIcon width={24} height={24} />
      </span>
      <span className="text-sm">{t("common.loading")}</span>
    </div>
  );
}
