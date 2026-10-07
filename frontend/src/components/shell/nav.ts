import type { ComponentType, SVGProps } from "react";
import {
  BoxIcon,
  BuildingIcon,
  ClipboardIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  HistoryIcon,
  InboxIcon,
  KeyIcon,
  ListIcon,
  MapPinIcon,
  MonitorIcon,
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
import { EMPTY_UI_CONFIG, has, isAllowed, isLocalSuperAdmin, sortByOrder, type UiConfig } from "@/lib/permissions";
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

/** เมนูตามสิทธิ์ (permission key จาก /auth/me) */
const perm = (key: string): Visible => (u) => has(u, key);

/** โครงสร้างเมนูหลัก — ใช้ร่วมกันทั้ง Sidebar และ Topbar */
export const NAV: NavGroup[] = [
  {
    // มุมผู้แจ้ง — ทุกคนรวมฝ่าย IT (ฝ่าย IT แจ้งงานเองได้): แจ้งใหม่ / ใบที่ฉันแจ้ง / รอฉันอนุมัติ
    id: "requests",
    label: "nav.requests",
    icon: ClipboardIcon,
    items: [
      { label: "nav.ticketNew", href: "/tickets/new", icon: PlusIcon },
      { label: "nav.ticketMine", href: "/tickets", icon: InboxIcon },
      { label: "nav.ticketApprovals", href: "/tickets/approvals", icon: CheckCircleIcon, visible: (u) => Boolean(u.can_approve) || has(u, "tickets.approve_any") },
    ],
  },
  {
    // มุมผู้ทำงาน — เฉพาะฝ่าย IT: คิวงาน (ทุกใบที่อนุมัติแล้ว) / KPI — ใบที่เจ้าหน้าที่ IT แจ้งเองจึงอยู่ทั้งสองที่ในบทบาทต่างกัน
    id: "it-work",
    label: "nav.itWork",
    icon: WrenchIcon,
    items: [
      { label: "nav.itBackoffice", href: "/it/tickets", icon: WrenchIcon, visible: perm("it_tickets.queue") },
      { label: "nav.kpi", href: "/kpi", icon: ChartIcon, visible: perm("kpi.use") },
    ],
  },
  {
    id: "it-data",
    label: "nav.itData",
    icon: KeyIcon,
    items: [
      { label: "nav.vault", href: "/vault", icon: KeyIcon, visible: (u) => has(u, "vault.view") || has(u, "vault.create") },
      { label: "nav.contracts", href: "/contracts", icon: FileTextIcon, visible: (u) => has(u, "contracts.view") || has(u, "contracts.create") },
    ],
  },
  {
    id: "assets",
    label: "nav.assets",
    icon: BoxIcon,
    items: [
      // ทุกคนเห็น — ไม่มีสิทธิ์ assets.view_all = เห็นเฉพาะสินทรัพย์ที่ตัวเองถือครอง
      { label: "nav.assetList", href: "/assets", icon: ListIcon },
      { label: "nav.movements", href: "/movements", icon: HistoryIcon, visible: perm("movements.view") },
      { label: "nav.repairs", href: "/repairs", icon: WrenchIcon, visible: (u) => has(u, "assets.view_all") || has(u, "assets.update") },
      { label: "nav.licenseInstallations", href: "/license-installations", icon: MonitorIcon, visible: perm("licenses.install") },
    ],
  },
  {
    id: "master",
    label: "nav.masterData",
    icon: DatabaseIcon,
    items: [
      { label: "nav.branches", href: "/branches", icon: BuildingIcon, visible: perm("branches.manage") },
      { label: "nav.divisions", href: "/divisions", icon: BuildingIcon, visible: perm("org.manage") },
      { label: "nav.departments", href: "/departments", icon: UsersIcon, visible: perm("org.manage") },
      { label: "nav.locations", href: "/locations", icon: MapPinIcon, visible: (u) => has(u, "locations.view") || has(u, "locations.manage") },
      { label: "nav.users", href: "/users", icon: UsersIcon, visible: perm("users.view") },
      { label: "nav.apiUsers", href: "/api-users", icon: UsersIcon, visible: perm("access.assign") },
      { label: "nav.ticketTypes", href: "/ticket-types", icon: ListIcon, visible: perm("settings.manage") },
    ],
  },
  {
    id: "settings",
    label: "nav.systemSettings",
    icon: SettingsIcon,
    items: [
      { label: "nav.notificationSettings", href: "/settings", icon: BellIcon, visible: perm("settings.manage") },
      { label: "nav.approvalRoutes", href: "/approval-routes", icon: GitBranchIcon, visible: perm("approval_routes.manage") },
      { label: "nav.announcements", href: "/announcements", icon: BellIcon, visible: perm("announcements.manage") },
      { label: "nav.permissions", href: "/permissions", icon: ShieldIcon, visible: perm("access.manage") },
      { label: "nav.rolePermissions", href: "/role-permissions", icon: ShieldIcon, visible: (u) => has(u, "access.manage") || has(u, "access.assign") },
      { label: "nav.apiConnections", href: "/api-connections", icon: GitBranchIcon, visible: isLocalSuperAdmin },
      { label: "nav.auditLogs", href: "/audit-logs", icon: HistoryIcon, visible: perm("audit_logs.view") },
    ],
  },
];

/**
 * เมนูที่ผู้ใช้คนนี้เห็น — สิทธิ์จริง (visible) + การตั้งค่าหน้าสิทธิ์การใช้งาน (ซ่อนเพิ่ม/จัดลำดับ)
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
