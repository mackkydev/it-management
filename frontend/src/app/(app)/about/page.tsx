import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { AboutView } from "./about-view";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("about.title") };
}

/** เกี่ยวกับระบบ — เวอร์ชันปัจจุบัน รายละเอียดโดยย่อ และประวัติการอัปเดต (ทุกคนเปิดได้) */
export default function AboutPage() {
  return <AboutView />;
}
