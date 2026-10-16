import type { ComponentType, SVGProps } from "react";
import {
  BoxIcon,
  CalendarIcon,
  SunIcon,
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
  MeetingRoomIcon,
  CarIcon,
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
  /** ชื่อที่ผู้ดูแลแก้เอง (หน้าสิทธิ์การใช้งาน) — ใส่ให้โดย navFor */
  text?: { th: string; en: string };
  href: string;
  icon: IconType;
  /** ไม่ระบุ = ทุกคนเห็น */
  visible?: Visible;
}

export interface NavGroup {
  id: string;
  label: MessageKey;
  text?: { th: string; en: string };
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
    // ปฏิทิน + การลา — ทุกคน: ปฏิทิน / ขอลา / ใบลาของฉัน / รออนุมัติลา (ผู้อนุมัติ) / วันหยุดบริษัท (ผู้ดูแลระบบ)
    id: "calendar",
    label: "nav.calendarGroup",
    icon: CalendarIcon,
    items: [
      { label: "nav.calendar", href: "/calendar", icon: CalendarIcon },
      { label: "nav.leaveNew", href: "/leave/new", icon: PlusIcon },
      { label: "nav.leaveMine", href: "/leave", icon: InboxIcon },
      { label: "nav.leaveApprovals", href: "/leave/approvals", icon: CheckCircleIcon, visible: (u) => Boolean(u.can_approve) || has(u, "leave.approve_any") },
      // ทุกคนดูวันหยุดได้ — จัดการ/ตั้งค่าการลาเฉพาะ holidays.manage (มอบให้กลุ่ม HR ได้)
      { label: "nav.holidays", href: "/holidays", icon: SunIcon },
    ],
  },
  {
    // ห้องประชุม — ทุกคน: ปฏิทินห้อง / จองห้อง / การจองของฉัน; จัดการห้อง = meeting.rooms
    id: "meeting",
    label: "nav.meetingGroup",
    icon: MeetingRoomIcon,
    items: [
      { label: "nav.meetingCalendar", href: "/meeting-rooms", icon: CalendarIcon },
      { label: "nav.meetingBook", href: "/meeting-rooms/book", icon: PlusIcon },
      { label: "nav.meetingMine", href: "/meeting-rooms/mine", icon: InboxIcon },
      { label: "nav.meetingRooms", href: "/meeting-rooms/rooms", icon: MeetingRoomIcon, visible: perm("meeting.rooms") },
    ],
  },
  {
    // จองรถ — ทุกคน: ปฏิทินรถ / จองรถ / การจองของฉัน; จัดคิวรถ = vehicle.dispatch (ตัวเลข = รอจัดรถ), จัดการรถ = vehicle.manage
    id: "vehicle",
    label: "nav.vehicleGroup",
    icon: CarIcon,
    items: [
      { label: "nav.vehicleCalendar", href: "/vehicles", icon: CalendarIcon },
      { label: "nav.vehicleBook", href: "/vehicles/book", icon: PlusIcon },
      { label: "nav.vehicleMine", href: "/vehicles/mine", icon: InboxIcon },
      { label: "nav.vehicleDispatch", href: "/vehicles/dispatch", icon: CheckCircleIcon, visible: perm("vehicle.dispatch") },
      { label: "nav.vehicleManage", href: "/vehicles/manage", icon: CarIcon, visible: perm("vehicle.manage") },
    ],
  },
  {
    // ยืมอุปกรณ์ IT — ทุกคน: ปฏิทิน / ยืม / การยืมของฉัน (ตัวเลข = เกินกำหนดคืน); ส่งมอบ/รับคืน = loans.manage (ตัวเลข = รอส่งมอบที่ถึงวัน + เกินกำหนด)
    id: "loans",
    label: "nav.loanGroup",
    icon: BoxIcon,
    items: [
      { label: "nav.loanCalendar", href: "/loans", icon: CalendarIcon },
      { label: "nav.loanBook", href: "/loans/book", icon: PlusIcon },
      { label: "nav.loanMine", href: "/loans/mine", icon: InboxIcon },
      { label: "nav.loanManage", href: "/loans/manage", icon: CheckCircleIcon, visible: perm("loans.manage") },
    ],
  },
  {
    // มุมผู้ทำงาน — เฉพาะฝ่าย IT: คิวงานของฉัน (เฉพาะใบของตัวเอง + ตัวเลขงานรอ) / คิวงาน IT (ทุกใบ — รับงานแทนได้) / KPI
    id: "it-work",
    label: "nav.itWork",
    icon: WrenchIcon,
    items: [
      { label: "nav.itMyQueue", href: "/it/tickets", icon: InboxIcon, visible: perm("it_tickets.queue") },
      { label: "nav.itBackoffice", href: "/it/queue", icon: WrenchIcon, visible: perm("it_tickets.queue") },
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
      // ฝ่าย + แผนก รวมเป็นหน้าเดียว (แท็บ) — /divisions, /departments พามาที่แท็บนั้น
      { label: "nav.orgUnits", href: "/org-units", icon: BuildingIcon, visible: perm("org.manage") },
      // ข้อมูล Drop Down: หมวดหมู่สัญญา / หมวดหมู่คลังบัญชี / Computer Type / ยี่ห้อ / ตัวเลือกเรื่อง "อื่นๆ" (แท็บตามสิทธิ์)
      { label: "nav.dropdowns", href: "/dropdowns", icon: ListIcon, visible: (u) => has(u, "contracts.categories") || has(u, "dropdowns.manage") || has(u, "settings.manage") || has(u, "meeting.rooms") || has(u, "vehicle.manage") },
      { label: "nav.locations", href: "/locations", icon: MapPinIcon, visible: (u) => has(u, "locations.view") || has(u, "locations.manage") },
      { label: "nav.users", href: "/users", icon: UsersIcon, visible: perm("users.view") },
      { label: "nav.apiUsers", href: "/api-users", icon: UsersIcon, visible: perm("access.assign") },
    ],
  },
  {
    id: "settings",
    label: "nav.systemSettings",
    icon: SettingsIcon,
    items: [
      { label: "nav.notificationSettings", href: "/settings", icon: SettingsIcon, visible: perm("settings.manage") },
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
  const labels = config.menu_labels ?? {};
  const groups = NAV.map((g) => ({
    ...g,
    text: labels[g.id],
    items: sortByOrder(
      g.items.filter((i) => (!i.visible || i.visible(user)) && isAllowed(config, user, i.href)).map((i) => ({ ...i, text: labels[i.href] })),
      config.menu_order.items?.[g.id],
      (i) => i.href,
    ),
  })).filter((g) => g.items.length > 0);
  return sortByOrder(groups, config.menu_order.groups, (g) => g.id);
}

/** ชื่อเมนูที่แสดง: ชื่อที่แก้เองของภาษานั้น → ไม่มีใช้ชื่อตั้งต้นจากไฟล์แปล */
export const navLabel = (x: { label: MessageKey; text?: { th: string; en: string } }, t: (k: MessageKey) => string, locale: string) =>
  x.text?.[locale === "en" ? "en" : "th"] || t(x.label);

/** เมนูที่ตรงกับ path ปัจจุบันมากที่สุด (เช่น /assets/123/edit → รายการสินทรัพย์, /assets/new → เพิ่มสินทรัพย์) */
export function activeHref(groups: NavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    const match = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}
