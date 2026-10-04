export type AssetStatus = "active" | "in_storage" | "in_repair" | "lost" | "disposed";

export const LOCATION_TYPES = ["site", "building", "floor", "room", "warehouse"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export interface Location {
  id: number;
  code: string;
  name: string;
  type: string;
  parent_id: number | null;
  address?: string | null;
  is_active?: boolean;
  /** มีเฉพาะ GET /locations?include_inactive=1 และ GET /locations/{id} */
  assets_count?: number;
  children_count?: number;
}

export interface LocationFormValues {
  code: string;
  name: string;
  type: string;
  parent_id: string;
  address: string;
  is_active: boolean;
}

export interface Asset {
  id: string; // uuid
  asset_tag: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: AssetStatus;
  status_label: string;
  location: Location | null;
  custodian: { id: number; name: string } | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  warranty_expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** รูปแบบ pagination มาตรฐานของ Laravel API Resource */
export interface Paginated<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "manager" | "viewer";
  // สังกัด / สายบังคับบัญชา / ฝ่าย IT
  branch_id?: number | null;
  branch?: { id: number; name: string } | null;
  department?: string | null;
  division?: string | null;
  supervisor_id?: number | null;
  supervisor?: { id: number; name: string } | null;
  is_it_staff?: boolean;
  is_it_head?: boolean;
  /** URL ลายเซ็นในโปรไฟล์ (เฉพาะข้อมูลของตัวเอง) — เช่น /auth/me/signature?v=... */
  signature_url?: string | null;
  is_active?: boolean;
  created_at?: string | null;
}

/* ---------------- IT-SYSTEM ---------------- */

export interface Branch {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  users_count?: number;
  tickets_count?: number;
}

export interface AppSettings {
  contract_notify_days: number;
  credential_notify_days: number;
  notify_emails: string[];
  ticket_other_types: string[];
}

export const CREDENTIAL_CATEGORIES = ["system", "server", "network", "email", "software", "cloud", "other"] as const;
export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

export interface Credential {
  id: number;
  title: string;
  category: CredentialCategory;
  url: string | null;
  username: string | null;
  has_password: boolean;
  has_secret_notes: boolean;
  notes: string | null;
  branch: { id: number; name: string } | null;
  branch_id: number | null;
  owner: { id: number; name: string } | null;
  expires_at: string | null;
  password_changed_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Contract {
  id: number;
  title: string;
  vendor_name: string;
  contract_no: string | null;
  start_date: string;
  end_date: string;
  amount: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notify_days_before: number | null;
  effective_notify_days: number;
  notify_enabled: boolean;
  notified_at: string | null;
  notes: string | null;
  branch: { id: number; name: string } | null;
  branch_id: number | null;
  days_left: number;
  status: "active" | "expiring" | "expired";
}

export const TICKET_TYPES = ["repair", "install", "grant_access", "revoke_access", "other"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_STATUSES = ["pending_supervisor", "approved", "in_progress", "pending_it_head", "completed", "rejected"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketAction = "approve" | "reject" | "accept" | "result" | "close" | "return";

type Person = { id: number; name: string } | null;

export interface TicketSummary {
  id: string;
  ticket_no: string;
  type: TicketType;
  type_other: string | null;
  status: TicketStatus;
  details: string;
  requester: Person;
  assignee: Person;
  branch: { id: number; name: string } | null;
  due_date: string | null;
  requested_at: string;
  actions: TicketAction[];
}

export interface TicketDetail extends TicketSummary {
  department: string | null;
  division: string | null;
  requester: { id: number; name: string; email: string } | null;
  person_name_th: string | null;
  person_name_en: string | null;
  device_name: string | null;
  asset_tag: string | null;
  asset: { id: string; asset_tag: string; name: string } | null;
  symptom: string | null;
  approver: Person;
  approved_at: string | null;
  accepted_at: string | null;
  result: "completed" | "cannot_complete" | null;
  completed_on: string | null;
  cannot_reason: string | null;
  repair_method: "in_house" | "external" | null;
  external_vendor: string | null;
  warranty: "in_warranty" | "out_of_warranty" | null;
  repair_details: string | null;
  resulted_at: string | null;
  it_head: Person;
  closed_at: string | null;
  signatures: { requester: string | null; staff: string | null; it_head: string | null };
  attachments: { id: number; kind: "request" | "result" | "document"; name: string | null; mime: string | null; size: number; url: string }[];
  parts: { id: number; name: string; quantity: number; photo_url: string | null }[];
  events: { id: number; action: string; comment: string | null; user: Person; created_at: string }[];
}

export interface TicketCounts {
  mine_open: number;
  approvals: number;
  it_new?: number;
  it_in_progress?: number;
  it_review?: number;
}

export interface AppNotification {
  id: string;
  data:
    | { kind: "ticket"; event: string; ticket_id: string; ticket_no: string; ticket_type: TicketType; actor: string | null }
    | { kind: "expiring"; count: number; items: { type: string; title: string; date: string; days_left: number }[] };
  read_at: string | null;
  created_at: string;
}

/** ประวัติการโอนย้าย (GET /assets/{id}/movements) */
export interface AssetMovement {
  id: number;
  /** มีเฉพาะในรายงานรวม GET /movements */
  asset?: { id: string; asset_tag: string; name: string } | null;
  type: "registered" | "transfer";
  type_label: string;
  from_location: Pick<Location, "id" | "code" | "name"> | null;
  to_location: Pick<Location, "id" | "code" | "name"> | null;
  from_custodian: { id: number; name: string } | null;
  to_custodian: { id: number; name: string } | null;
  moved_at: string;
  reason: string | null;
  performed_by: { id: number; name: string } | null;
  created_at: string;
}

export const ROLES = ["admin", "manager", "viewer"] as const;

/** ผู้ใช้ในหน้าจัดการ (GET /users?manage=1, GET /users/{id}) — admin เท่านั้น */
export interface ManagedUser extends User {
  is_active: boolean;
  custodian_assets_count?: number;
  created_at?: string;
}

export interface UserFormValues {
  name: string;
  email: string;
  role: User["role"];
  is_active: boolean;
  password: string;
  password_confirmation: string;
  branch_id: string;
  department: string;
  division: string;
  supervisor_id: string;
  is_it_staff: boolean;
  is_it_head: boolean;
}

/** ผู้ใช้แบบย่อสำหรับตัวเลือกผู้ถือครอง (GET /users) */
export interface UserOption {
  id: number;
  name: string;
  email: string;
}

export const CATEGORIES = ["IT", "FURNITURE", "VEHICLE", "EQUIPMENT"];

/** ค่าจากฟอร์ม (string ทั้งหมด) — แปลงเป็น payload ของ API ใน server action */
export interface AssetFormValues {
  asset_tag: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  serial_number: string;
  status: AssetStatus;
  location_id: string;
  custodian_id: string;
  purchase_date: string;
  purchase_cost: string;
  warranty_expires_at: string;
  notes: string;
  /** เหตุผลการโอนย้าย — ส่งเฉพาะตอนแก้ไขและสถานที่/ผู้ถือครองเปลี่ยน */
  movement_reason: string;
}

export type FieldErrors = Partial<Record<keyof AssetFormValues, string>>;

/** ค่าสถานะทั้งหมด — ข้อความแสดงผลอยู่ใน dictionary: t(`status.${value}`) */
export const STATUSES: AssetStatus[] = ["active", "in_storage", "in_repair", "lost", "disposed"];
