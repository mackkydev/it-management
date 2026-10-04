import { iso } from "../lib/time.js";
import { bool } from "../lib/validator.js";
import type { Role } from "./user.js";

/** แถวของตาราง api_connections — การเชื่อมต่อ REST API ต้นทางสำหรับ API User */
export interface ApiConnectionRow {
  id: number;
  name: string;
  is_enabled: boolean;
  base_url: string;
  timeout_ms: number;
  login_method: string;
  login_path: string;
  login_username_field: string;
  login_password_field: string;
  login_body_type: LoginBodyType;
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
  field_map: FieldMap;
  role_rules: RoleRule[];
  default_role: Role;
  error_code_path: string | null;
  error_messages: Record<string, ErrorMessage>;
  auth_type: AuthType;
  auth_header_name: string | null;
  auth_username: string | null;
  /** ciphertext (Laravel Crypt format) — ห้ามส่งกลับ frontend / ห้าม log */
  auth_secret: string | null;
  allowed_hosts: string[];
  max_redirects: number;
  register_url: string | null;
  forgot_password_url: string | null;
  change_password_url: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export const AUTH_TYPES = ["none", "api_key", "bearer", "basic"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const LOGIN_BODY_TYPES = ["json", "form"] as const;
export type LoginBodyType = (typeof LOGIN_BODY_TYPES)[number];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;

/** path (dot path) ของข้อมูลโปรไฟล์ใน response ต้นทาง */
export interface FieldMap {
  external_id?: string;
  name?: string;
  email?: string;
  role_code?: string;
}

/** ค่า role_code ที่ตรง value → role ของระบบเรา (ไม่ตรงกฎใด = default_role) */
export interface RoleRule {
  value: string;
  role: Role;
}

/** ประเภทของ error ต้นทาง — ใช้เลือกข้อความ/พฤติกรรม (invalid = ข้อความกลาง ไม่บอกว่ามี username หรือไม่) */
export const ERROR_KINDS = ["invalid", "password_expired", "locked", "disabled", "other"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface ErrorMessage {
  kind: ErrorKind;
  message_th?: string;
  message_en?: string;
}

/** JSON สำหรับหน้าตั้งค่า — ไม่มี auth_secret (บอกแค่ว่าตั้งไว้หรือยัง) */
export function apiConnectionResource(c: ApiConnectionRow) {
  const { auth_secret, created_by: _c, updated_by: _u, ...rest } = c;
  return {
    ...rest,
    is_enabled: bool(c.is_enabled),
    has_auth_secret: auth_secret !== null && auth_secret !== "",
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  };
}
