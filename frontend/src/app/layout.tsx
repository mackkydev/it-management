import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { DialogProvider } from "@/components/dialog-provider";
import { PrefsProvider } from "@/components/prefs-provider";
import { PwaRegister } from "@/components/pwa-register";
import { I18nProvider } from "@/i18n/client";
import { getI18n } from "@/i18n/server";
import { customThemeVars } from "@/lib/color";
import { getPrefs } from "@/lib/prefs-server";
import type { CSSProperties } from "react";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t("app.fullName"), template: `%s | ${t("app.name")}` },
    description: t("app.tagline"),
    applicationName: t("app.name"),
    // PWA: manifest มาจาก src/app/manifest.ts อัตโนมัติ — ส่วนนี้สำหรับ iOS (Add to Home Screen)
    appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "black-translucent" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050816",
};

/**
 * โหมด "ตามระบบ": ตั้ง class .dark ก่อนหน้าเว็บแสดงผล เพื่อไม่ให้กระพริบจากสว่างเป็นมืด
 * (server ไม่รู้ว่าเครื่องผู้ใช้ตั้งโหมดอะไร) — ค่าคงที่ ไม่มีข้อมูลจากผู้ใช้ปนอยู่
 */
const MODE_SCRIPT = `(function(){try{var d=document.documentElement;if(d.dataset.mode==="system"){d.classList.toggle("dark",window.matchMedia("(prefers-color-scheme: dark)").matches)}}catch(e){}})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const prefs = await getPrefs();
  const { dict } = await getI18n();

  return (
    <html
      lang={prefs.locale}
      data-mode={prefs.mode}
      data-theme={prefs.theme}
      // ธีมกำหนดเอง: ชุดสีคำนวณจากสีที่เลือก (accent ผ่านการตรวจรูปแบบ #rrggbb แล้ว)
      style={prefs.theme === "custom" ? (customThemeVars(prefs.accent) as CSSProperties) : undefined}
      className={`${notoSansThai.variable} ${prefs.mode === "dark" ? "dark" : ""} h-full antialiased`}
      suppressHydrationWarning // class .dark อาจถูกเพิ่มโดย MODE_SCRIPT ก่อน hydrate
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="min-h-full bg-canvas text-ink">
        <I18nProvider locale={prefs.locale} dict={dict}>
          <PrefsProvider initial={prefs}>
            <DialogProvider>{children}</DialogProvider>
          </PrefsProvider>
          <PwaRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
