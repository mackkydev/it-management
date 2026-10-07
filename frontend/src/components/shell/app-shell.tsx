"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, MonitorIcon, MenuIcon, SettingsIcon, UserIcon, XIcon } from "@/components/icons";
import { LinkPendingIcon } from "@/components/pending";
import { usePrefs } from "@/components/prefs-provider";
import { Tooltip } from "@/components/tooltip";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { UiConfig } from "@/lib/permissions";
import type { Layout } from "@/lib/prefs";
import type { User } from "@/lib/types";
import { APP_VERSION, compareVersions, initSeenVersion, readSeenVersion, subscribeSeenVersion } from "@/lib/changelog";
import { activeHref, navFor, type NavGroup } from "./nav";
import { NotificationBell } from "./notification-bell";
import { GroupBadge, ItemBadge, MenuBadgesProvider } from "./menu-badges";
import { PrefsControls } from "./prefs-controls";
import { SidebarNav } from "./sidebar-nav";
import { Avatar, LogoutButton, UserLabel } from "./user-bits";

/**
 * ปิด dropdown เมื่อคลิกนอกกรอบ หรือกด Escape
 * คลิกใน panel ที่ render ผ่าน portal ([data-flyout]) ไม่นับเป็นคลิกนอกกรอบ (panel เป็นส่วนของเมนูนั้น)
 */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest?.("[data-flyout]")) return;
      if (ref.current && !ref.current.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

/** เวอร์ชันโลโก้ระบบจาก ui-config (null = ไม่มีโลโก้) */
const LogoVersionContext = createContext<string | null>(null);

/** โลโก้ระบบ (อัปโหลดที่หน้าตั้งค่าระบบ) — ไม่มีรูป = icon เดิม */
function LogoMark() {
  const version = useContext(LogoVersionContext);
  if (version) {
    // พื้นขาว + เงา → โลโก้สีใดก็เห็นชัดทั้งโหมดสว่างและโหมดมืด
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-0.5 shadow-md ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/15">
        {/* eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน /files (ไม่ผ่าน next/image) */}
        <img src={`/files/branding/logo?v=${encodeURIComponent(version)}`} alt="" className="h-full w-full rounded-lg object-contain" />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-200 text-accent-700 dark:bg-accent-400/20 dark:text-accent-300">
      <MonitorIcon width={19} height={19} />
    </span>
  );
}

/** มีเวอร์ชันใหม่ที่ผู้ใช้ยังไม่ได้เปิดดูหน้า /about (อ่านหลัง mount — localStorage) */
function useNewVersion() {
  // ฝั่ง server ถือว่าเห็นแล้ว (ไม่มีป้าย) — ฝั่ง client อ่านค่าจริงหลัง hydrate
  useEffect(initSeenVersion, []);
  const seen = useSyncExternalStore(subscribeSeenVersion, readSeenVersion, () => APP_VERSION);
  return seen !== null && compareVersions(seen, APP_VERSION) < 0;
}

/** จุดแดงกะพริบ = มีเวอร์ชันใหม่ */
function NewDot({ className = "" }: { className?: string }) {
  return (
    <span className={`absolute flex h-2.5 w-2.5 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger-500 ring-2 ring-surface" />
    </span>
  );
}

/** โลโก้ + ชื่อระบบ + ป้ายเวอร์ชัน — คลิกเปิดหน้าเกี่ยวกับระบบ (เวอร์ชัน/สิ่งที่อัปเดต) */
function Logo() {
  const { t } = useI18n();
  const isNew = useNewVersion();
  return (
    <Link href="/about" title={t("about.openHint")} className="group flex cursor-pointer items-center gap-2 font-semibold text-ink">
      <LogoMark />
      <span className="leading-tight">
        <span className="flex items-center gap-1.5">
          {t("app.name")}
          <span
            className={`relative rounded-full px-1.5 py-px text-[10px] font-semibold leading-4 ring-1 ring-inset transition-colors ${
              isNew
                ? "bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-400/15 dark:text-danger-300 dark:ring-danger-400/30"
                : "bg-subtle text-muted ring-line group-hover:bg-accent-100 group-hover:text-accent-700 dark:group-hover:bg-accent-400/15 dark:group-hover:text-accent-300"
            }`}
          >
            v{APP_VERSION}
            {isNew && <NewDot className="-right-1 -top-1" />}
          </span>
        </span>
        <span className="block text-xs font-normal text-muted">{isNew ? t("about.newBadge") : t("app.tagline")}</span>
      </span>
    </Link>
  );
}

/** โลโก้ตอนย่อเมนู — มีจุดแดงเมื่อมีเวอร์ชันใหม่ */
function CollapsedLogo() {
  const { t } = useI18n();
  const isNew = useNewVersion();
  return (
    <Tooltip label={`${t("app.fullName")} v${APP_VERSION}`}>
      <Link href="/about" aria-label={`${t("app.fullName")} v${APP_VERSION}`} className="relative block cursor-pointer">
        <LogoMark />
        {isNew && <NewDot className="-right-0.5 -top-0.5" />}
      </Link>
    </Tooltip>
  );
}

/** กล่องย่อ/ขยายแบบนุ่ม (grid-rows 0fr → 1fr) — ตอนย่อใช้ inert กันโฟกัสเข้าไปในเนื้อหาที่ซ่อน */
function Collapse({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  );
}

const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60";

/**
 * แผงการตั้งค่าที่เปิดออกไปทางขวาของปุ่ม (ใช้กับ sidebar บนจอใหญ่)
 * render ผ่าน portal ไปที่ body — ไม่ถูก sidebar (overflow-y-auto) ตัด และอยู่เหนือเนื้อหาหน้า
 * ขอบล่างของแผงตรงกับขอบล่างของปุ่ม แล้วขยายขึ้นด้านบน
 */
function SettingsFlyout({ id, anchor, onClose }: { id: string; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    bottom: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      // ชิดขอบขวาของกรอบที่อยู่ (sidebar หรือ popover ของ sidebar แบบย่อ) ไม่ทับเส้นขอบ
      const edge = anchor.current?.closest("[data-flyout-edge]")?.getBoundingClientRect().right ?? r.right;
      setPos({
        left: edge + 8,
        bottom: Math.max(8, window.innerHeight - r.bottom - 8),
        maxHeight: Math.max(240, r.bottom - 8),
      });
    };
    place();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      data-flyout=""
      role="dialog"
      aria-label={t("nav.settings")}
      style={{ left: pos.left, bottom: pos.bottom, maxHeight: pos.maxHeight }}
      className="fixed z-50 w-80 animate-[flyout-in_150ms_ease-out] overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-line"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <SettingsIcon width={15} height={15} className="text-accent-500 dark:text-accent-300" />
          {t("nav.settings")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-subtle hover:text-ink"
        >
          <XIcon width={15} height={15} />
        </button>
      </div>
      <PrefsControls />
    </div>,
    document.body,
  );
}

/**
 * รายการในเมนูบัญชี: แก้ไขข้อมูลส่วนตัว / การตั้งค่า / ออกจากระบบ
 * settings="flyout": การตั้งค่าเปิดเป็นแผงทางขวา (sidebar จอใหญ่), "inline": ขยายในเมนู (มือถือ / เมนูแถบบน)
 */
function AccountActions({ onNavigate, settings = "inline" }: { onNavigate?: () => void; settings?: "inline" | "flyout" }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  const settingsBtn = useRef<HTMLButtonElement>(null);
  const flyout = settings === "flyout";

  return (
    <div className="space-y-0.5">
      <Link
        href="/profile"
        onClick={onNavigate}
        aria-current={pathname === "/profile" ? "page" : undefined}
        className={`${MENU_ITEM} ${pathname === "/profile" ? "bg-accent-100 font-medium text-accent-800 dark:bg-accent-400/15 dark:text-accent-200" : ""}`}
      >
        <LinkPendingIcon icon={<UserIcon width={15} height={15} className="text-accent-500 dark:text-accent-300" />} size={15} />
        {t("nav.editProfile")}
      </Link>

      <button
        ref={settingsBtn}
        type="button"
        aria-expanded={settingsOpen}
        aria-controls={settingsId}
        aria-haspopup={flyout ? "dialog" : undefined}
        onClick={() => setSettingsOpen((o) => !o)}
        className={`${MENU_ITEM} ${settingsOpen ? "bg-subtle" : ""}`}
      >
        <SettingsIcon width={15} height={15} className="text-accent-500 dark:text-accent-300" />
        <span className="flex-1 text-left">{t("nav.settings")}</span>
        <ChevronDownIcon width={14} height={14} className={`text-faint transition-transform ${flyout ? "-rotate-90" : settingsOpen ? "rotate-180" : ""}`} />
      </button>
      {flyout ? (
        settingsOpen && <SettingsFlyout id={settingsId} anchor={settingsBtn} onClose={() => setSettingsOpen(false)} />
      ) : (
        <Collapse open={settingsOpen} id={settingsId}>
          <div className="mx-1 my-1 rounded-xl bg-subtle/60 p-3">
            <PrefsControls />
          </div>
        </Collapse>
      )}

      <LogoutButton className={MENU_ITEM} />
    </div>
  );
}

/**
 * ส่วนล่างของ sidebar: เริ่มต้นแสดงแค่ชื่อผู้ใช้/บทบาท
 * คลิกแล้วเมนูบัญชีจะขยายขึ้นด้านบน (แก้ไขข้อมูลส่วนตัว / การตั้งค่า / ออกจากระบบ)
 */
function SidebarFooter({ user, onNavigate, settings = "inline" }: { user: User; onNavigate?: () => void; settings?: "inline" | "flyout" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div className="border-t border-line pt-3">
      <Collapse open={open} id={menuId}>
        <div className="pb-2">
          {/* key: ปิดเมนูบัญชีแล้วรีเซ็ตสถานะ → แผงการตั้งค่าปิดตาม (เนื้อหายังอยู่ให้ animation ย่อทำงาน) */}
          <AccountActions key={open ? "open" : "closed"} onNavigate={onNavigate} settings={settings} />
        </div>
      </Collapse>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("nav.accountMenu")}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl p-2 transition-colors hover:bg-subtle ${open ? "bg-subtle" : ""}`}
      >
        <Avatar user={user} />
        <UserLabel user={user} />
        {/* ชี้ขึ้นตอนปิด (เมนูจะขยายขึ้นด้านบน) */}
        <ChevronDownIcon width={15} height={15} className={`ml-auto shrink-0 text-faint transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}

/* ---------------- Sidebar แบบย่อ (เหลือแค่ icon + tooltip) ---------------- */

const ICON_BTN =
  "flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300";

/** เมนูแบบ icon: ทุกเมนูย่อยแสดงเป็น icon เรียงตามกลุ่ม (คั่นด้วยเส้น) ชี้แล้วแสดงชื่อเมนู */
function CollapsedNav({ groups }: { groups: NavGroup[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activeHref(groups, pathname);

  return (
    <nav aria-label="Main" className="flex flex-col items-center gap-1">
      {groups.map((group, gi) => (
        <div key={group.id} className="flex flex-col items-center gap-1">
          {gi > 0 && <span className="my-1.5 h-px w-8 bg-line" aria-hidden="true" />}
          {group.items.map((item) => {
            const current = item.href === active;
            return (
              <Tooltip key={item.href} label={`${t(group.label)} · ${t(item.label)}`}>
                <Link
                  href={item.href}
                  aria-label={t(item.label)}
                  aria-current={current ? "page" : undefined}
                  className={`${ICON_BTN} relative ${
                    current
                      ? "bg-accent-200 text-accent-800 dark:bg-accent-400/25 dark:text-accent-200"
                      : "text-accent-600 hover:bg-accent-100 dark:text-accent-300 dark:hover:bg-accent-400/10"
                  }`}
                >
                  <LinkPendingIcon icon={<item.icon width={18} height={18} />} size={18} />
                  <ItemBadge href={item.href} dot />
                </Link>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** ส่วนล่างของ sidebar แบบย่อ: avatar (tooltip ชื่อ) — คลิกแล้วเมนูบัญชีเปิดเป็น popover ด้านขวา */
function CollapsedFooter({ user }: { user: User }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="flex justify-center border-t border-line pt-3">
      <Tooltip label={`${user.name} · ${t(`roles.${user.role}`)}`} disabled={open}>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t("nav.accountMenu")}
          onClick={() => setOpen((o) => !o)}
          className={`cursor-pointer rounded-full p-0.5 transition-shadow ${open ? "ring-2 ring-accent-300" : "hover:ring-2 hover:ring-accent-200"}`}
        >
          <Avatar user={user} />
        </button>
      </Tooltip>
      {open && (
        // fixed: ไม่ถูกตัดโดย sidebar ที่ scroll ได้ — วางชิดขวาของ sidebar ด้านล่าง
        <div
          data-flyout-edge=""
          className="fixed bottom-4 left-[88px] z-50 max-h-[calc(100vh-2rem)] w-80 overflow-y-auto rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-line"
        >
          <div className="mb-1 flex items-center gap-3 border-b border-line p-2 pb-3">
            <Avatar user={user} />
            <div className="min-w-0">
              <UserLabel user={user} />
              <div className="truncate text-xs text-faint">{user.email}</div>
            </div>
          </div>
          <AccountActions onNavigate={() => setOpen(false)} settings="flyout" />
        </div>
      )}
    </div>
  );
}

/** sidebar บนจอใหญ่ — ย่อ/ขยายได้ (จำค่าไว้ใน cookie) */
function DesktopSidebar({ groups, user }: { groups: NavGroup[]; user: User }) {
  const { t } = useI18n();
  const { sidebar, set } = usePrefs();
  const collapsed = sidebar === "collapsed";
  const toggle = () => set("sidebar", collapsed ? "expanded" : "collapsed");

  const toggleLabel = collapsed ? t("nav.expand") : t("nav.collapse");

  // ปุ่มย่อ/ขยายวางคร่อมเส้นขอบขวา — อยู่นอก aside (aside มี overflow-x-hidden จะตัดปุ่มทิ้ง)
  return (
    <div className="sticky top-0 z-20 hidden h-screen shrink-0 lg:flex">
      <aside
        data-flyout-edge=""
        className={`flex h-full flex-col gap-5 overflow-y-auto overflow-x-hidden border-r border-line bg-surface transition-[width,padding] duration-200 ease-out ${
          collapsed ? "w-[76px] px-2 py-4" : "w-72 p-4"
        }`}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <CollapsedLogo />
            <NotificationBell size="lg" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1">
            <Logo />
            <NotificationBell size="lg" />
          </div>
        )}

        <div className="flex-1">{collapsed ? <CollapsedNav groups={groups} /> : <SidebarNav groups={groups} />}</div>

        {collapsed ? <CollapsedFooter user={user} /> : <SidebarFooter user={user} settings="flyout" />}
      </aside>

      <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2">
        <Tooltip label={toggleLabel}>
          <button
            type="button"
            onClick={toggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-surface text-muted shadow-sm ring-1 ring-line transition-colors hover:bg-accent-50 hover:text-accent-600 hover:ring-accent-300 dark:hover:bg-accent-400/15 dark:hover:text-accent-300"
          >
            {collapsed ? <ChevronRightIcon width={14} height={14} /> : <ChevronLeftIcon width={14} height={14} />}
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

/** ลิ้นชักเมนูสำหรับมือถือ/แท็บเล็ต (ใช้ได้ทั้งสองรูปแบบเมนู — แสดงเต็มเสมอ) */
function MobileDrawer({ open, onClose, groups, user }: { open: boolean; onClose: () => void; groups: NavGroup[]; user: User }) {
  const { t } = useI18n();
  return (
    <div className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} inert={!open}>
      <div
        className={`absolute inset-0 cursor-pointer bg-slate-900/40 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.sm} px-2`} aria-label={t("common.closeMenu")}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="flex-1">
          <SidebarNav groups={groups} onNavigate={onClose} />
        </div>
        <SidebarFooter user={user} onNavigate={onClose} />
      </aside>
    </div>
  );
}

/** แถบบนสำหรับมือถือ (ทั้งสองรูปแบบเมนู) */
function MobileBar({ onOpen, user }: { onOpen: () => void; user: User }) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
      <button type="button" onClick={onOpen} className={`${btn.secondary} ${btn.sm} px-2`} aria-label={t("common.openMenu")}>
        <MenuIcon width={18} height={18} />
      </button>
      <Logo />
      <div className="flex items-center gap-1">
        <NotificationBell tooltipSide="bottom" />
        <Link href="/profile" aria-label={t("nav.profile")} className="cursor-pointer">
          <Avatar user={user} size="sm" />
        </Link>
      </div>
    </header>
  );
}

/* ---------------- Topbar ---------------- */

/** เมนูหลักแบบ dropdown (เปิดได้ทีละเมนู) */
function TopNav({ groups }: { groups: NavGroup[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activeHref(groups, pathname);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open !== null, () => setOpen(null));

  return (
    <nav ref={ref} className="hidden items-center gap-1 lg:flex" aria-label="Main">
      {groups.map((group) => {
        const isOpen = open === group.id;
        const hasActive = group.items.some((i) => i.href === active);
        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-haspopup="menu"
              onClick={() => setOpen(isOpen ? null : group.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                hasActive || isOpen ? "bg-accent-100 text-accent-800 dark:bg-accent-400/15 dark:text-accent-200" : "text-ink hover:bg-subtle"
              }`}
            >
              <group.icon width={16} height={16} className={hasActive || isOpen ? "" : "text-accent-500 dark:text-accent-300"} />
              {t(group.label)}
              <GroupBadge hrefs={group.items.map((i) => i.href)} />
              <ChevronDownIcon width={14} height={14} className={`text-faint transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div role="menu" className="absolute left-0 top-full z-40 mt-2 w-60 rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-line">
                {group.items.map((item) => {
                  const current = item.href === active;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(null)}
                      aria-current={current ? "page" : undefined}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                        current ? "bg-accent-100 font-medium text-accent-800 dark:bg-accent-400/15 dark:text-accent-200" : "text-ink hover:bg-subtle"
                      }`}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-400/10 dark:text-accent-300">
                        <LinkPendingIcon icon={<item.icon width={15} height={15} />} size={15} />
                      </span>
                      <span className="flex-1">{t(item.label)}</span>
                      <ItemBadge href={item.href} />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** เมนู avatar ชิดขวา: แก้ไขข้อมูลส่วนตัว / การตั้งค่า (คลิกเพื่อขยาย) / ออกจากระบบ — เหมือนเมนูบัญชีใน sidebar */
function AvatarMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 rounded-xl p-1 pr-2 transition-colors hover:bg-subtle"
      >
        <Avatar user={user} size="sm" />
        <span className="hidden xl:block">
          <UserLabel user={user} />
        </span>
        <ChevronDownIcon width={14} height={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100vh-5rem)] w-80 overflow-y-auto rounded-2xl bg-surface p-2 shadow-lg ring-1 ring-line">
          <div className="mb-1 flex items-center gap-3 border-b border-line p-2 pb-3">
            <Avatar user={user} />
            <div className="min-w-0">
              <UserLabel user={user} />
              <div className="truncate text-xs text-faint">{user.email}</div>
            </div>
          </div>
          <AccountActions onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Shell ---------------- */

export function AppShell({ layout, user, uiConfig, children }: { layout: Layout; user: User; uiConfig: UiConfig; children: ReactNode }) {
  const groups = navFor(user, uiConfig);
  const [drawer, setDrawer] = useState(false);

  // เนื้อหาเต็มความกว้างหน้าจอ (ไม่จำกัด max-width)
  const main = <main className="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>;

  if (layout === "topbar") {
    return (
      <MenuBadgesProvider>
      <LogoVersionContext.Provider value={uiConfig.logo_version}>
        <div className="flex min-h-screen flex-col">
          <MobileBar onOpen={() => setDrawer(true)} user={user} />
          <header className="sticky top-0 z-30 hidden border-b border-line bg-surface/90 backdrop-blur lg:block">
            <div className="flex items-center gap-6 px-8 py-2.5">
              <Logo />
              <TopNav groups={groups} />
              <div className="ml-auto flex items-center gap-2">
                <NotificationBell tooltipSide="bottom" />
                <AvatarMenu user={user} />
              </div>
            </div>
          </header>
          <MobileDrawer open={drawer} onClose={() => setDrawer(false)} groups={groups} user={user} />
          {main}
        </div>
      </LogoVersionContext.Provider>
      </MenuBadgesProvider>
    );
  }

  return (
    <MenuBadgesProvider>
    <LogoVersionContext.Provider value={uiConfig.logo_version}>
      <div className="flex min-h-screen">
        <DesktopSidebar groups={groups} user={user} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar onOpen={() => setDrawer(true)} user={user} />
          <MobileDrawer open={drawer} onClose={() => setDrawer(false)} groups={groups} user={user} />
          {main}
        </div>
      </div>
    </LogoVersionContext.Provider>
    </MenuBadgesProvider>
  );
}
