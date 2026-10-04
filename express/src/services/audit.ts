import { insert } from "../db.js";
import { nowDb } from "../lib/time.js";

/**
 * audit_logs — ใคร / เมื่อไร / อะไร / ก่อน-หลัง / IP
 * key ที่เป็นความลับ (secret / token / รหัสผ่าน) ถูกตัดออกเสมอ — ห้ามมี credential ใน log
 */
const SENSITIVE = /^(auth_secret|secret|password|password_confirmation|current_password|token|access_token|refresh_token)$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

export interface AuditEntry {
  action: string;
  subjectType: string;
  subjectId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** ผู้กระทำ: request ของ Express หรือ { ip, user } ที่ประกอบเอง (เช่น ตอน JIT provisioning) */
export type AuditActor = { ip?: string; user?: { id: number } };

export async function audit(req: AuditActor, entry: AuditEntry): Promise<void> {
  await insert("audit_logs", {
    actor_id: req.user?.id ?? null,
    action: entry.action,
    subject_type: entry.subjectType,
    subject_id: entry.subjectId === undefined || entry.subjectId === null ? null : String(entry.subjectId),
    before: entry.before === undefined ? null : JSON.stringify(redact(entry.before)),
    after: entry.after === undefined ? null : JSON.stringify(redact(entry.after)),
    ip: req.ip ?? null,
    created_at: nowDb(),
  });
}
