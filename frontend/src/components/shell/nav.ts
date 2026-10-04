import type { ComponentType, SVGProps } from "react";
import {
  BoxIcon,
  BuildingIcon,
  ClipboardIcon,
  DatabaseIcon,
  FileTextIcon,
  HistoryIcon,
  InboxIcon,
  KeyIcon,
  ListIcon,
  MapPinIcon,
  PlusIcon,
  SettingsIcon,
  BellIcon,
  ChartIcon,
  CheckCircleIcon,
  ShieldIcon,
  UsersIcon,
  WrenchIcon,
} from "@/components/icons";
import type { MessageKey } from "@/i18n/types";
import { EMPTY_UI_CONFIG, isAllowed, sortByOrder, type UiConfig } from "@/lib/permissions";
import type { User } from "@/lib/types";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
type Visible = (user: User) => boolean;

export interface NavItem {
  label: MessageKey;
  href: string;
  icon: IconType;
  /** ไม่ระบุ = ทุกคนเห็น */
  visible?: Visible;
}

export interface NavGroup {
  id: string;
  label: MessageKey;
  icon: IconType;
  items: NavItem[];
}

const admin: Visible = (u) => u.role === "admin";
const managers: Visible = (u) => u.role === "admin" || u.role === "manager";
const itData: Visible = (u) => u.role === "admin" || Boolean(u.is_it_staff || u.is_it_head);

/** โครงสร้างเมนูหลัก — ใช้ร่วมกันทั้ง Sidebar และ Topbar */
export const NAV: NavGroup[] = [
  {
    id: "it-work",
    label: "nav.itWork",
    icon: ClipboardIcon,
    items: [
      { label: "nav.ticketNew", href: "/tickets/new", icon: PlusIcon },
      { label: "nav.ticketMine", href: "/tickets", icon: InboxIcon },
      { label: "nav.ticketApprovals", href: "/tickets/approvals", icon: CheckCircleIcon },
      { label: "nav.itBackoffice", href: "/it/tickets", icon: WrenchIcon, visible: itData },
      { label: "nav.kpi", href: "/kpi", icon: ChartIcon },
    ],
  },
  {
    id: "it-data",
    label: "nav.itData",
    icon: KeyIcon,
    items: [
      { label: "nav.vault", href: "/vault", icon: KeyIcon, visible: itData },
      { label: "nav.contracts", href: "/contracts", icon: FileTextIcon, visible: itData },
    ],
  },
  {
    id: "assets",
    label: "nav.assets",
    icon: BoxIcon,
    items: [
      { label: "nav.assetList", href: "/assets", icon: ListIcon },
      { label: "nav.assetNew", href: "/assets/new", icon: PlusIcon, visible: managers },
      { label: "nav.movements", href: "/movements", icon: HistoryIcon },
    ],
  },
  {
    id: "master",
    label: "nav.masterData",
    icon: DatabaseIcon,
    items: [
      { label: "nav.branches", href: "/branches", icon: BuildingIcon, visible: admin },
      { label: "nav.locations", href: "/locations", icon: MapPinIcon },
      { label: "nav.locationNew", href: "/locations/new", icon: PlusIcon, visible: managers },
      { label: "nav.users", href: "/users", icon: UsersIcon, visible: managers },
      { label: "nav.userNew", href: "/users/new", icon: PlusIcon, visible: admin },
    ],
  },
  {
    id: "settings",
    label: "nav.systemSettings",
    icon: SettingsIcon,
    items: [
      { label: "nav.notificationSettings", href: "/settings", icon: BellIcon, visible: admin },
      { label: "nav.permissions", href: "/permissions", icon: ShieldIcon, visible: admin },
    ],
  },
];

/**
 * เมนูที่ผู้ใช้คนนี้เห็น — สิทธิ์เดิมของระบบ (visible) + การตั้งค่าหน้าสิทธิ์ (ซ่อนเพิ่ม/จัดลำดับ)
 * ซ่อนเฉพาะ UI — สิทธิ์จริงตรวจที่ API
 */
export function navFor(user: User, config: UiConfig = EMPTY_UI_CONFIG): NavGroup[] {
  const groups = NAV.map((g) => ({
    ...g,
    items: sortByOrder(
      g.items.filter((i) => (!i.visible || i.visible(user)) && isAllowed(config, user, i.href)),
      config.menu_order.items?.[g.id],
      (i) => i.href,
    ),
  })).filter((g) => g.items.length > 0);
  return sortByOrder(groups, config.menu_order.groups, (g) => g.id);
}

/** เมนูที่ตรงกับ path ปัจจุบันมากที่สุด (เช่น /assets/123/edit → รายการสินทรัพย์, /assets/new → เพิ่มสินทรัพย์) */
export function activeHref(groups: NavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const match = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}
