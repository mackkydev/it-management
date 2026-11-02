import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found-view";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("notFound.title") };
}

/** ที่อยู่ไม่ตรงกับหน้าใดเลย (นอก app shell) — ผู้ที่ยังไม่ login ถูก proxy พาไปหน้า login ก่อนถึงหน้านี้ */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas">
      <NotFoundView />
    </main>
  );
}
