import type { Metadata } from "next";
import { ClipboardIcon, HistoryIcon, MonitorIcon, PrinterIcon } from "@/components/icons";
import { alert } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { getI18n } from "@/i18n/server";
import { apiFetch } from "@/lib/api";
import type { LoginConnection, PublicAnnouncement } from "@/lib/types";
import { AnnouncementTicker } from "./announcement-ticker";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("auth.login") };
}

/**
 * หน้าเข้าสู่ระบบ — ฉากโทนเทคโนโลยี (มืดเสมอ) + motion, กล่อง login แบบกระจกลอยอยู่ทางขวา
 * class "dark" บนฉาก: ช่องกรอก/ปุ่มใช้ token ของโหมดมืดเฉพาะหน้านี้ ไม่เปลี่ยนค่าที่ผู้ใช้ตั้งไว้
 */
/** ประกาศจากฝ่าย IT (API ไม่ต้อง login) — ดึงไม่ได้ก็แสดงหน้า login ตามปกติ */
async function getAnnouncements(): Promise<PublicAnnouncement[]> {
  try {
    return (await apiFetch<{ data: PublicAnnouncement[] }>("/announcements/public")).data;
  } catch {
    return [];
  }
}

/** ช่องทาง login ผ่านระบบต้นทาง (ดึงไม่ได้ = แสดงเฉพาะบัญชีในระบบ) */
async function getConnections(): Promise<LoginConnection[]> {
  try {
    return (await apiFetch<{ data: LoginConnection[] }>("/auth/connections")).data;
  } catch {
    return [];
  }
}

/** key ตามชุดประกาศ — ประกาศเปลี่ยน (LiveRefresh) แล้วตัวเลื่อนเริ่มนับใหม่จากแถวแรก */
function Announcements({ items, title }: { items: PublicAnnouncement[]; title: string }) {
  return <AnnouncementTicker key={items.map((a) => a.id).join(",")} items={items} title={title} />;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { expired } = await searchParams;
  const [{ t }, announcements, connections] = await Promise.all([getI18n(), getAnnouncements(), getConnections()]);
  // ยังไม่รู้ว่าใครเข้าระบบ — แสดงเฉพาะความสามารถที่ผู้ใช้ทุกคน (รวมพนักงานนอกฝ่าย IT) ใช้ได้
  const features = [
    { icon: ClipboardIcon, title: t("auth.feature1") },
    { icon: HistoryIcon, title: t("auth.feature2") },
    { icon: PrinterIcon, title: t("auth.feature3") },
  ];

  return (
    <main className="login-scene dark flex min-h-screen items-center px-4 py-10 sm:px-8 lg:px-16">
      {/* ประกาศใหม่/แก้ไข/ลบ → หน้านี้อัปเดตเองโดยไม่ต้องกดรีเฟรช */}
      <LiveRefresh scope="public" intervalMs={30_000} />
      <span className="login-orb login-orb-1" aria-hidden="true" />
      <span className="login-orb login-orb-2" aria-hidden="true" />
      <span className="login-orb login-orb-3" aria-hidden="true" />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1fr_26rem]">
        {/* ฝั่งซ้าย: ชื่อระบบ + จุดเด่น (ซ่อนบนจอเล็ก) */}
        <section className="login-fade-up hidden lg:block">
          <span className="login-chip login-glow inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium tracking-wide">
            <span className="login-dot h-1.5 w-1.5 animate-pulse rounded-full" />
            {t("app.tagline")}
          </span>
          <h1 className="mt-6 text-5xl font-semibold leading-tight tracking-tight">
            {t("app.name")}
            <span className="login-gradient-text mt-2 block text-3xl">
              {t("auth.heroTitle")}
            </span>
          </h1>
          <p className="login-muted mt-5 max-w-lg text-base leading-relaxed">{t("auth.heroText")}</p>
          {/* จุดเด่น: ไอคอน + ชื่อ เรียงแถวเดียว */}
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {features.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-2.5">
                <span className="login-chip login-glow flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                  <Icon width={17} height={17} />
                </span>
                <span className="text-sm font-medium">{title}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 max-w-xl">
            <Announcements items={announcements} title={t("auth.announcements")} />
          </div>
        </section>

        {/* ฝั่งขวา: กล่อง login แบบกระจก */}
        <section className="login-card login-fade-up w-full p-8 sm:p-10 lg:justify-self-end" style={{ animationDelay: "120ms" }}>
          <span className="login-badge flex h-12 w-12 items-center justify-center rounded-2xl">
            <MonitorIcon width={24} height={24} />
          </span>
          <h2 className="mt-6 text-2xl font-semibold">{t("auth.welcome")}</h2>
          <p className="login-muted mt-1 text-sm">{t("auth.welcomeText")}</p>
          {expired && <p className={`mt-5 ${alert.warning}`}>{t("auth.expired")}</p>}
          <LoginForm connections={connections} />
          <p className="login-muted mt-8 text-center text-xs">{t("auth.sessionNote")}</p>
        </section>

        {/* จอเล็ก: ฝั่งซ้ายซ่อนอยู่ — แสดงประกาศใต้กล่อง login แทน */}
        <section className="lg:hidden">
          <Announcements items={announcements} title={t("auth.announcements")} />
        </section>
      </div>
    </main>
  );
}
