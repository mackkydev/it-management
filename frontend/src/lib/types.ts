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
  /** เฉพาะหมวด SOFTWARE (null = ไม่มี) */
  license?: AssetLicense | null;
  /** เฉพาะหน้ารายละเอียด */
  files?: AssetFile[];
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
  role: Role;
  /** LOCAL = ผู้ใช้ของระบบเรา / API = ผู้ใช้จาก REST API ต้นทาง (ไม่มีรหัสผ่านในระบบเรา) */
  type?: "LOCAL" | "API";
  /** สิทธิ์จริง (permission key) จาก GET /auth/me — ใช้ผ่าน has(user, key) */
  permissions?: string[];
  /** API User (จาก GET /auth/me): ระบบต้นทาง + ลิงก์เปลี่ยนรหัสผ่านที่ต้นทาง */
  external_connection?: { name: string; change_password_url: string | null };
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
  /** สายอนุมัติที่กำหนดรายบุคคล (null = จับคู่อัตโนมัติตามสาขา+แผนก) */
  approval_route_id?: number | null;
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
  license_notify_days: number;
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
export const TICKET_STATUSES = ["pending_supervisor", "approved", "in_progress", "pending_it_head", "completed", "rejected", "pending_cancel", "cancelled"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketAction =
  | "approve" | "reject" | "accept" | "progress" | "result" | "close" | "return"
  | "edit" | "delete" | "cancel_request" | "cancel_confirm" | "cancel_reject" | "cancel_withdraw";

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
  /** ขอยกเลิกหลังอนุมัติ (pending_cancel → cancelled) */
  cancel_reason: string | null;
  cancel_requested_at: string | null;
  cancel_requested_status: TicketStatus | null;
  cancelled_at: string | null;
  cancelled_by: { id: number; name: string } | null;
  signatures: { requester: string | null; staff: string | null; it_head: string | null };
  attachments: { id: number; kind: "request" | "result" | "document"; name: string | null; mime: string | null; size: number; url: string }[];
  parts: { id: number; name: string; quantity: number; photo_url: string | null }[];
  events: { id: number; action: string; comment: string | null; user: Person; created_at: string }[];
  /** ขั้นอนุมัติปัจจุบัน (null = ระบบเดิม หรืออนุมัติครบแล้ว) */
  current_step: number | null;
  /** ขั้นอนุมัติตามสายอนุมัติ — ว่าง = ใบที่ใช้ระบบเดิม (หัวหน้าคนเดียว) */
  approval_steps: TicketApprovalStep[];
}

export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "skipped";

export interface TicketApprovalStep {
  step_no: number;
  name: string;
  status: ApprovalStepStatus;
  approvers: { id: number; name: string }[];
  acted_by: Person;
  acted_at: string | null;
  comment: string | null;
}

/** สายอนุมัติ (GET /approval-routes) */
export interface ApprovalRoute {
  id: number;
  name: string;
  branch: { id: number; name: string } | null;
  department: string | null;
  is_active: boolean;
  steps: { step_no: number; name: string; approvers: { id: number; name: string; is_active: boolean }[] }[];
  users_count: number;
}

export type ApprovalSource = "user" | "branch_department" | "branch" | "department" | "default" | "legacy";

/** แผนอนุมัติของผู้ใช้ (GET /approval-routes/resolve) */
export interface ApprovalPlan {
  source: ApprovalSource;
  route: { id: number; name: string } | null;
  steps: { step_no: number; name: string; approvers: { id: number; name: string }[]; skipped: boolean }[];
  legacy_approver: { id: number; name: string } | null;
}

export interface TicketCounts {
  mine_open: number;
  approvals: number;
  it_new?: number;
  it_in_progress?: number;
  it_mine?: number;
  it_review?: number;
  it_cancel?: number;
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

/** ผู้ดูแลระบบ / ผู้จัดการฝ่าย / ผู้จัดการ / เจ้าหน้าที่ IT / พนักงาน — สิทธิ์ของแต่ละบทบาทตั้งที่หน้า "สิทธิ์ตามบทบาท" */
export const ROLES = ["admin", "division_manager", "manager", "it_staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** ผู้ใช้ในหน้าจัดการ (GET /users?manage=1, GET /users/{id}) — admin เท่านั้น */
export interface ManagedUser extends User {
  is_active: boolean;
  custodian_assets_count?: number;
  /** มีลายเซ็นที่ใช้งานอยู่ไหม (หน้าจัดการผู้ใช้ — ไม่แสดงรูป) */
  has_signature?: boolean;
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
  /** "" = จับคู่สายอนุมัติอัตโนมัติตามสาขา+แผนก */
  approval_route_id: string;
}

/** ผู้ใช้แบบย่อสำหรับตัวเลือกผู้ถือครอง (GET /users) */
export interface UserOption {
  id: number;
  name: string;
  email: string;
}

export const CATEGORIES = ["IT", "SOFTWARE", "FURNITURE", "VEHICLE", "EQUIPMENT"];

/**
 * หมวดหมู่กำหนดฟอร์มเพิ่มเติม — license: แสดงส่วนข้อมูล license (+ ไฟล์ license), hide: ซ่อนช่องที่ไม่เกี่ยว
 * หมวดที่ไม่อยู่ในนี้ใช้ฟอร์มปกติ — เพิ่มหมวด/ฟิลด์ใหม่แก้ที่นี่ที่เดียว
 */
export const CATEGORY_FORM: Record<string, { license?: boolean; hide?: (keyof AssetFormValues)[] }> = {
  SOFTWARE: { license: true, hide: ["serial_number", "warranty_expires_at"] },
};

export const LICENSE_BILLINGS = ["yearly", "custom", "perpetual"] as const;
export type LicenseBilling = (typeof LICENSE_BILLINGS)[number];

export interface AssetLicense {
  billing: LicenseBilling;
  start_date: string;
  expires_at: string | null;
  /** ติดลบ = หมดอายุแล้ว, null = ถาวร */
  days_left: number | null;
  seats: number | null;
  vendor: string | null;
  notify_days_before: number | null;
  has_key: boolean;
}

export const ANNOUNCEMENT_LEVELS = ["info", "warning", "danger"] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

/** แผนก / ฝ่าย (ข้อมูลหลัก) — GET /departments, /divisions */
export interface OrgUnit {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  users_count?: number;
}

/** ช่องทาง login ผ่านระบบต้นทางที่เปิดอยู่ (GET /auth/connections — ไม่ต้อง login) */
export interface LoginConnection {
  id: number;
  name: string;
  register_url: string | null;
  forgot_password_url: string | null;
}

/** ประกาศบนหน้า login (GET /announcements/public) */
export interface PublicAnnouncement {
  id: number;
  title: string;
  body: string | null;
  level: AnnouncementLevel;
  starts_on: string | null;
  ends_on: string | null;
}

/** GET /announcements (หน้าจัดการ) */
export interface Announcement extends PublicAnnouncement {
  is_active: boolean;
  sort_order: number;
  created_by: { id: number; name: string } | null;
  updated_at: string | null;
}

/** จำนวน seat: seats null = ไม่จำกัด */
export interface LicenseUsage {
  seats: number | null;
  used: number;
  available: number | null;
}

/** GET /license-installations/licenses */
export interface LicenseSummary extends LicenseUsage {
  id: string;
  asset_tag: string;
  name: string;
  expires_at: string | null;
  days_left: number | null;
}

export interface LicenseInstallation {
  id: number;
  license: { id: string; asset_tag: string; name: string };
  device: { id: string; asset_tag: string; name: string } | null;
  device_name: string | null;
  user: { id: number; name: string } | null;
  branch: { id: number; name: string } | null;
  installed_at: string;
  uninstalled_at: string | null;
  notes: string | null;
  created_by: { id: number; name: string } | null;
  created_at: string | null;
}

export interface AssetFile {
  id: number;
  kind: string;
  name: string;
  mime: string;
  size: number;
  /** path ของ API — เปิดผ่าน /files{url} */
  url: string;
}

export interface LicenseFormValues {
  billing: LicenseBilling;
  start_date: string;
  expires_at: string;
  seats: string;
  vendor: string;
  /** ว่าง = คงค่าเดิม (ตอนแก้ไข) */
  license_key: string;
  clear_license_key: boolean;
  notify_days_before: string;
}

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
  /** ใช้เมื่อหมวดมี license (CATEGORY_FORM) */
  license: LicenseFormValues;
}

export type FieldErrors = Partial<Record<Exclude<keyof AssetFormValues, "license"> | "license" | `license.${keyof LicenseFormValues}`, string>>;

/** ค่าสถานะทั้งหมด — ข้อความแสดงผลอยู่ใน dictionary: t(`status.${value}`) */
export const STATUSES: AssetStatus[] = ["active", "in_storage", "in_repair", "lost", "disposed"];

/* ---------------------------------------------------------------- API User / สิทธิ์ / audit (Local Admin) */

export type PermissionGroup = "tickets" | "it_data" | "assets" | "users" | "system";

export interface PermissionDef {
  key: string;
  group: PermissionGroup;
  name_th: string;
  name_en: string;
}

export type OverrideEffect = "allow" | "deny";

/** GET /users/{id}/permissions */
export interface UserPermissionView {
  user: { id: number; name: string; email: string | null; type: "LOCAL" | "API"; role: User["role"]; is_active: boolean; is_it_staff: boolean; is_it_head: boolean };
  groups: string[];
  inherited: string[];
  overrides: Record<string, OverrideEffect>;
  effective: string[];
  is_local_admin: boolean;
}

/** GET /api-users */
export interface ApiUser {
  id: number;
  name: string;
  email: string | null;
  role: "manager" | "viewer" | "admin";
  is_active: boolean;
  external_id: string;
  external_synced_at: string | null;
  created_at: string | null;
  connection_id: number;
  connection_name: string;
  overrides_count: number;
  /** อีเมลจากต้นทางที่ซ้ำกับผู้ใช้อื่น (รอผูกบัญชี) */
  conflict_email: string | null;
  conflict_user_id: number | null;
}

export const API_AUTH_TYPES = ["none", "api_key", "bearer", "basic"] as const;
export type ApiAuthType = (typeof API_AUTH_TYPES)[number];
export const API_ERROR_KINDS = ["invalid", "password_expired", "locked", "disabled", "other"] as const;
export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

/** GET /api-connections — ไม่มี secret (has_auth_secret บอกแค่ว่าตั้งไว้หรือยัง) */
export interface ApiConnection {
  id: number;
  name: string;
  is_enabled: boolean;
  base_url: string;
  timeout_ms: number;
  login_method: string;
  login_path: string;
  login_username_field: string;
  login_password_field: string;
  login_body_type: "json" | "form";
  profile_method: string;
  profile_path: string | null;
  profile_root_path: string | null;
  logout_path: string | null;
  refresh_path: string | null;
  token_path: string;
  token_ttl_path: string | null;
  refresh_token_path: string | null;
  default_token_ttl_seconds: number;
  profile_cache_seconds: number;
  field_map: { external_id?: string; name?: string; email?: string; role_code?: string };
  role_rules: { value: string; role: "manager" | "viewer" }[];
  default_role: "manager" | "viewer";
  error_code_path: string | null;
  error_messages: Record<string, { kind: ApiErrorKind; message_th?: string | null; message_en?: string | null }>;
  auth_type: ApiAuthType;
  auth_header_name: string | null;
  auth_username: string | null;
  has_auth_secret: boolean;
  allowed_hosts: string[];
  max_redirects: number;
  register_url: string | null;
  forgot_password_url: string | null;
  change_password_url: string | null;
  users_count: number;
  created_at: string | null;
  updated_at: string | null;
}

/** POST /api-connections/{id}/test */
export type ApiConnectionTest =
  | { ok: true; profile: { external_id: string; name: string; email: string | null; role_code: string | null; role: "manager" | "viewer" }; token_expires_in: number; has_refresh_token: boolean }
  | { ok: false; kind: string; message: string };

/** GET /audit-logs */
export interface AuditLog {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  subject_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}
