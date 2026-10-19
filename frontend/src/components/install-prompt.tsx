"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { CheckCircleIcon, InstallIcon, MoreVerticalIcon, PlusSquareIcon, ShareIosIcon, XIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/types";

/**
 * แถบ "ติดตั้ง (Install)" ด้านล่างจอ — เฉพาะมือถือ / iPad ที่ยังไม่ได้ติดตั้งเป็นแอป (PWA)
 * Android: ใช้หน้าต่างติดตั้งของ Chrome (beforeinstallprompt) ถ้ามี ไม่มี = บอกขั้นตอนเอง
 * iPhone / iPad: Safari ไม่มีปุ่มติดตั้งให้เรียก → เปิดแผ่นวิธี "เพิ่มไปยังหน้าจอโฮม"
 * กด "ไว้ทีหลัง" = ซ่อน 7 วัน (จำใน localStorage ของเครื่อง)
 *
 * ติดตั้งแล้ว = ไม่แสดงอีก: เปิดจากไอคอนแอป (standalone) / ติดตั้งสำเร็จ (appinstalled) / ผู้ใช้กด "ติดตั้งแล้ว"
 * → จำ INSTALLED_KEY ไว้; Android ตรวจเพิ่มด้วย getInstalledRelatedApps (manifest.related_applications)
 * (iOS: แอปบนหน้าจอโฮมแยก storage จาก Safari — Safari รู้เองไม่ได้ จึงมีปุ่ม "ติดตั้งแล้ว" ในแผ่นวิธีติดตั้ง)
 */

type Platform = "ios" | "android";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "it-install-dismissed-until";
const INSTALLED_KEY = "it-pwa-installed";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface InstallState {
  platform: Platform | null;
  /** เปิดในแอป LINE / Facebook / เบราว์เซอร์อื่นที่ติดตั้งไม่ได้ (บอกให้เปิดใน Safari / Chrome ก่อน) */
  otherBrowser: boolean;
  /** เปิดจากไอคอนแอปอยู่ หรือรู้แล้วว่าเครื่องนี้ติดตั้งแล้ว */
  installed: boolean;
  dismissed: boolean;
  /** เพิ่งติดตั้งสำเร็จในรอบนี้ (แสดงข้อความแจ้งสั้นๆ) */
  justInstalled: boolean;
  deferred: BeforeInstallPromptEvent | null;
}

const SERVER_STATE: InstallState = { platform: null, otherBrowser: false, installed: true, dismissed: true, justInstalled: false, deferred: null };
let state: InstallState | null = null;
const listeners = new Set<() => void>();

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // โหมดส่วนตัว / ปิด storage — จำได้เฉพาะรอบนี้
  }
}

/** จำว่าเครื่องนี้ติดตั้งแล้ว — ไม่แสดงแถบอีก */
function markInstalled(patch: Partial<InstallState> = {}) {
  writeStorage(INSTALLED_KEY, "1");
  update({ installed: true, deferred: null, ...patch });
}

function detect(): InstallState {
  const ua = navigator.userAgent;
  // iPadOS 13+ รายงานตัวเองเป็น Mac — แยกด้วยจอสัมผัส
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const inApp = /Line\/|FBAN|FBAV|Instagram|; wv\)/i.test(ua);
  const standalone =
    ["standalone", "fullscreen", "minimal-ui"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // เปิดจากไอคอนแอป = ติดตั้งแล้วแน่นอน — จำไว้ให้แท็บเบราว์เซอร์ (Android ใช้ storage ร่วมกับ Chrome)
  if (standalone) writeStorage(INSTALLED_KEY, "1");
  return {
    platform: ios ? "ios" : android ? "android" : null,
    otherBrowser: inApp || (ios && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)),
    installed: standalone || readStorage(INSTALLED_KEY) === "1",
    dismissed: Number(readStorage(DISMISS_KEY) ?? 0) > Date.now(),
    justInstalled: false,
    deferred: null,
  };
}

let relatedChecked = false;
/** Android Chrome: ถามเบราว์เซอร์ว่าติดตั้งแอปนี้ไว้แล้วหรือยัง (ติดตั้งจากเครื่องอื่น / ล้าง storage ไปแล้ว) */
function checkRelatedApps() {
  if (relatedChecked) return;
  relatedChecked = true;
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (getState().installed || !nav.getInstalledRelatedApps) return;
  nav
    .getInstalledRelatedApps()
    .then((apps) => apps.length > 0 && markInstalled())
    .catch(() => {});
}

function update(patch: Partial<InstallState>) {
  state = { ...getState(), ...patch };
  listeners.forEach((l) => l());
}

function getState(): InstallState {
  state ??= detect();
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onPrompt = (e: Event) => {
    e.preventDefault(); // ไม่ให้ Chrome แสดงแถบเอง — ใช้ปุ่มของเราแทน
    update({ deferred: e as BeforeInstallPromptEvent });
  };
  const onInstalled = () => markInstalled({ justInstalled: true });
  checkRelatedApps();
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function InstallPrompt() {
  const { t } = useI18n();
  const s = useSyncExternalStore(subscribe, getState, () => SERVER_STATE);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  // ปิดแผ่นด้วยปุ่ม Esc
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  if (!s.platform) return null;
  if (s.justInstalled) return <InstalledToast text={t("install.installed")} onClose={() => update({ justInstalled: false })} />;
  if (s.installed || (s.dismissed && !sheet)) return null;

  const dismiss = () => {
    writeStorage(DISMISS_KEY, String(Date.now() + SNOOZE_MS));
    setSheet(false);
    update({ dismissed: true });
  };

  const alreadyInstalled = () => {
    setSheet(false);
    markInstalled();
  };

  const install = async () => {
    if (s.platform === "android" && s.deferred) {
      setBusy(true);
      try {
        await s.deferred.prompt();
        const { outcome } = await s.deferred.userChoice;
        // ใช้ prompt ได้ครั้งเดียว — กดยกเลิกแล้วกดใหม่ = แสดงขั้นตอนเอง
        if (outcome === "accepted") markInstalled({ justInstalled: true });
        else update({ deferred: null });
      } catch {
        setSheet(true);
      } finally {
        setBusy(false);
      }
      return;
    }
    setSheet(true);
  };

  return (
    <>
      {/* กันเนื้อหาท้ายหน้าไม่ให้ถูกแถบบัง */}
      {!s.dismissed && <div aria-hidden className="h-24" />}

      {!s.dismissed && (
        <div
          role="region"
          aria-label={t("install.title")}
          className="install-anim fixed inset-x-0 bottom-0 z-40 animate-[install-bar-in_400ms_cubic-bezier(0.2,0.8,0.2,1)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] print:hidden"
        >
          <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-surface/95 p-2.5 pr-2 shadow-2xl ring-1 ring-line backdrop-blur">
            <button type="button" onClick={install} disabled={busy} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed">
              <AppBadge />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{t("install.title")}</span>
                <span className="line-clamp-2 text-xs text-muted">{t("install.subtitle")}</span>
              </span>
            </button>
            <button type="button" onClick={install} disabled={busy} className={`${btn.primary} shrink-0 rounded-full px-4`}>
              <InstallIcon className={busy ? "animate-pulse" : ""} />
              {t("install.button")}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("install.dismiss")}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-subtle hover:text-ink"
            >
              <XIcon />
            </button>
          </div>
        </div>
      )}

      {sheet && <InstallSheet platform={s.platform} otherBrowser={s.otherBrowser} onClose={() => setSheet(false)} onDismiss={dismiss} onInstalled={alreadyInstalled} />}
    </>
  );
}

/** ไอคอนแอปไล่สีธีม + โทรศัพท์ลูกศรลงที่ลอยขึ้นลงเบาๆ */
function AppBadge({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-700 text-white shadow-lg shadow-accent-500/30 ring-1 ring-white/20 ${
        large ? "h-16 w-16" : "h-12 w-12"
      }`}
    >
      <span className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/25 to-transparent" />
      <InstallIcon width={large ? 30 : 24} height={large ? 30 : 24} className="install-anim relative animate-[install-icon-float_2.4s_ease-in-out_infinite]" />
    </span>
  );
}

const IOS_STEPS: { key: MessageKey; icon?: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "install.iosSteps.share", icon: ShareIosIcon },
  { key: "install.iosSteps.add", icon: PlusSquareIcon },
  { key: "install.iosSteps.confirm" },
];
const ANDROID_STEPS: { key: MessageKey; icon?: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "install.androidSteps.menu", icon: MoreVerticalIcon },
  { key: "install.androidSteps.install" },
  { key: "install.androidSteps.confirm" },
];

/** แผ่นวิธีติดตั้งตามระบบของเครื่อง (เลื่อนขึ้นจากด้านล่าง) */
function InstallSheet({
  platform,
  otherBrowser,
  onClose,
  onDismiss,
  onInstalled,
}: {
  platform: Platform;
  otherBrowser: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const steps = platform === "ios" ? IOS_STEPS : ANDROID_STEPS;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center print:hidden" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title">
      <button type="button" aria-label={t("install.close")} onClick={onClose} className="absolute inset-0 cursor-pointer bg-overlay backdrop-blur-[2px]" />
      <div className="install-anim relative w-full max-w-md animate-[install-sheet-in_250ms_ease-out] rounded-t-3xl bg-surface px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-line sm:mb-6 sm:rounded-3xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("install.close")}
          className="absolute top-3 right-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-subtle hover:text-ink"
        >
          <XIcon />
        </button>

        <div className="flex items-center gap-4">
          <AppBadge large />
          <div className="min-w-0">
            <h2 id="install-sheet-title" className="text-base font-semibold text-ink">
              {t("install.sheetTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{t("install.benefits")}</p>
          </div>
        </div>

        <p className="mt-5 text-xs font-semibold tracking-wide text-accent-700 uppercase dark:text-accent-300">
          {t(platform === "ios" ? "install.iosTitle" : "install.androidTitle")}
        </p>
        <ol className="mt-2 space-y-2">
          {steps.map((step, i) => (
            <li key={step.key} className="flex items-start gap-3 rounded-2xl bg-subtle p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-200 text-xs font-bold text-accent-900 dark:bg-accent-400/25 dark:text-accent-200">
                {i + 1}
              </span>
              <span className="text-sm leading-6 text-ink">
                <StepText text={t(step.key)} Icon={step.icon} />
              </span>
            </li>
          ))}
        </ol>

        {otherBrowser && (
          <p className="mt-3 rounded-2xl bg-warning-100 px-3 py-2 text-xs text-warning-800 dark:bg-warning-400/15 dark:text-warning-200">
            {t(platform === "ios" ? "install.iosOtherBrowser" : "install.androidOtherBrowser")}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onDismiss} className={`${btn.secondary} flex-1`}>
            {t("install.dismiss")}
          </button>
          <button type="button" onClick={onClose} className={`${btn.primary} flex-1`}>
            {t("install.close")}
          </button>
        </div>
        <button
          type="button"
          onClick={onInstalled}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs text-muted hover:bg-subtle hover:text-ink"
        >
          <CheckCircleIcon />
          {t("install.alreadyInstalled")}
        </button>
      </div>
    </div>
  );
}

/** แทน {icon} ในข้อความด้วยไอคอนจริง (ปุ่มแชร์ / เพิ่มไปยังหน้าจอโฮม / เมนูจุดสามจุด) */
function StepText({ text, Icon }: { text: string; Icon?: ComponentType<SVGProps<SVGSVGElement>> }) {
  const [before, after] = text.split("{icon}");
  if (after === undefined || !Icon) return <>{text}</>;
  return (
    <>
      {before}
      <span className="mx-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-surface align-middle text-info-700 ring-1 ring-line dark:text-info-300">
        <Icon />
      </span>
      {after}
    </>
  );
}

/** ติดตั้งสำเร็จ (Android) — แจ้งสั้นๆ แล้วปิดเอง */
function InstalledToast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(id);
  }, [onClose]);
  return (
    <div role="status" className="install-anim fixed inset-x-0 bottom-0 z-40 animate-[install-bar-in_300ms_ease-out] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] print:hidden">
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-success-100 p-3 text-sm text-success-800 shadow-xl ring-1 ring-success-200 dark:bg-success-400/15 dark:text-success-200 dark:ring-success-400/30">
        <CheckCircleIcon width={20} height={20} className="shrink-0" />
        <span className="flex-1">{text}</span>
        <button type="button" onClick={onClose} className="cursor-pointer rounded-full p-1 hover:bg-success-200/60 dark:hover:bg-success-400/20">
          <XIcon />
        </button>
      </div>
    </div>
  );
}
