import { config } from "../config.js";
import { select, update } from "../db.js";
import { trans, type Locale } from "../lib/i18n.js";
import { addDays, dateOnly, diffInDays, displayDate, fromDbDate, nowDb, startOfUtcDay, toDbDate } from "../lib/time.js";
import { sendMail } from "../services/mail.js";
import { EXPIRING_DIGEST, notifyUsers } from "../services/notifications.js";
import { getSetting } from "../services/settings.js";

/**
 * แจ้งเตือนรายการใกล้หมดอายุ — เหมือนคำสั่ง `php artisan it:notify-expiring`
 * - สัญญา: เหลือ ≤ N วัน (N ของสัญญา หรือค่าเริ่มต้นในหน้าตั้งค่า)
 * - บัญชี/รหัสผ่าน: เหลือ ≤ credential_notify_days วัน
 * - software license: เหลือ ≤ N วัน (N ของ license หรือ license_notify_days)
 * แจ้งครั้งเดียวต่อวันหมดอายุ (ต่ออายุแล้ววันหมดอายุเปลี่ยน → แจ้งใหม่ได้)
 */
export interface ExpiringItem {
  type: "contract" | "credential" | "license";
  title: string;
  sub: string | null;
  date: string;
  days_left: number;
}

export interface NotifyResult {
  items: ExpiringItem[];
  sent: boolean;
}

export async function notifyExpiring(opts: { dryRun?: boolean; today?: Date } = {}): Promise<NotifyResult> {
  const today = startOfUtcDay(opts.today ?? new Date());
  const yesterday = toDbDate(addDays(today, -1));
  const items: ExpiringItem[] = [];
  const contractIds: Array<{ id: number; end_date: string }> = [];
  const credentialIds: Array<{ id: number; expires_at: string }> = [];
  const licenseIds: Array<{ id: number; expires_at: string }> = [];

  const defaultDays = Number(await getSetting("contract_notify_days"));
  const contracts = await select<{ id: number; title: string; vendor_name: string; end_date: string; notify_days_before: number | null; notified_for_end_date: string | null }>(
    "SELECT id, title, vendor_name, end_date, notify_days_before, notified_for_end_date FROM contracts WHERE deleted_at IS NULL AND notify_enabled = true AND end_date >= ?",
    [yesterday],
  );
  for (const c of contracts) {
    const left = diffInDays(today, fromDbDate(c.end_date));
    const already = c.notified_for_end_date !== null && dateOnly(c.notified_for_end_date) === dateOnly(c.end_date);
    if (left <= (c.notify_days_before ?? defaultDays) && !already) {
      items.push({ type: "contract", title: c.title, sub: c.vendor_name, date: dateOnly(c.end_date)!, days_left: left });
      contractIds.push({ id: c.id, end_date: dateOnly(c.end_date)! });
    }
  }

  const credentialDays = Number(await getSetting("credential_notify_days"));
  const credentials = await select<{ id: number; title: string; username: string | null; expires_at: string; notified_for_expires_at: string | null }>(
    `SELECT id, title, username, expires_at, notified_for_expires_at FROM credentials
      WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ? AND expires_at >= ?`,
    [toDbDate(addDays(today, credentialDays)), yesterday],
  );
  for (const c of credentials) {
    if (c.notified_for_expires_at && dateOnly(c.notified_for_expires_at) === dateOnly(c.expires_at)) continue;
    items.push({ type: "credential", title: c.title, sub: c.username, date: dateOnly(c.expires_at)!, days_left: diffInDays(today, fromDbDate(c.expires_at)) });
    credentialIds.push({ id: c.id, expires_at: dateOnly(c.expires_at)! });
  }

  // software license: เหลือ ≤ N วัน (N ของ license หรือค่าเริ่มต้นในหน้าตั้งค่า) — ไม่นับสินทรัพย์ที่ถูกลบ
  const licenseDays = Number(await getSetting("license_notify_days"));
  const licenses = await select<{ id: number; expires_at: string; notify_days_before: number | null; notified_for_expires_at: string | null; asset_tag: string; name: string }>(
    `SELECT li.id, li.expires_at, li.notify_days_before, li.notified_for_expires_at, a.asset_tag, a.name
       FROM asset_licenses li JOIN assets a ON a.id = li.asset_id
      WHERE a.deleted_at IS NULL AND li.expires_at IS NOT NULL AND li.expires_at >= ?`,
    [yesterday],
  );
  for (const l of licenses) {
    const left = diffInDays(today, fromDbDate(l.expires_at));
    const already = l.notified_for_expires_at !== null && dateOnly(l.notified_for_expires_at) === dateOnly(l.expires_at);
    if (left <= (l.notify_days_before ?? licenseDays) && !already) {
      items.push({ type: "license", title: l.name, sub: l.asset_tag, date: dateOnly(l.expires_at)!, days_left: left });
      licenseIds.push({ id: l.id, expires_at: dateOnly(l.expires_at)! });
    }
  }

  if (items.length === 0 || opts.dryRun) return { items, sent: false };

  // อีเมลจากหน้าตั้งค่า (ภาษาเริ่มต้นของระบบ — ไม่ใส่ข้อมูลลับในอีเมล)
  for (const email of (await getSetting("notify_emails")) ?? []) {
    await sendMail({ to: email, ...digestMail(items, config.defaultLocale) });
  }

  // แจ้งเตือนในระบบ: admin + เจ้าหน้าที่ IT ที่ยังใช้งาน
  const recipients = await select<{ id: number }>(
    "SELECT id FROM users WHERE is_active = true AND (role IN ('super_admin', 'admin') OR is_it_staff = true OR is_it_head = true)",
  );
  await notifyUsers(recipients.map((r) => r.id), EXPIRING_DIGEST, { kind: "expiring", count: items.length, items: items.slice(0, 10) });

  for (const c of contractIds) await update("contracts", { notified_for_end_date: c.end_date, notified_at: nowDb() }, "id = ?", [c.id]);
  for (const c of credentialIds) await update("credentials", { notified_for_expires_at: c.expires_at }, "id = ?", [c.id]);
  for (const l of licenseIds) await update("asset_licenses", { notified_for_expires_at: l.expires_at }, "id = ?", [l.id]);

  return { items, sent: true };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** เนื้อหาอีเมลแบบเดียวกับ ExpiringItemsDigest::toMail */
export function digestMail(items: ExpiringItem[], locale: Locale) {
  const lines = items.map(
    (i) =>
      `• [${trans(locale, `eam.expiring.type.${i.type}`)}] ${i.title}${i.sub ? ` / ${i.sub}` : ""} — ${displayDate(i.date, locale)} (${
        i.days_left < 0 ? trans(locale, "eam.expiring.expired") : trans(locale, "eam.expiring.days_left", { days: i.days_left })
      })`,
  );
  const url = `${(config.frontendUrls[0] ?? "").replace(/\/$/, "")}/contracts`;
  const greeting = trans(locale, "eam.expiring.greeting");
  const intro = trans(locale, "eam.expiring.intro");
  const open = trans(locale, "eam.expiring.open");

  return {
    subject: trans(locale, "eam.expiring.subject", { count: items.length }),
    text: [greeting, "", intro, "", ...lines, "", `${open}: ${url}`].join("\n"),
    html: `<p><strong>${escapeHtml(greeting)}</strong></p><p>${escapeHtml(intro)}</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(url)}">${escapeHtml(open)}</a></p>`,
  };
}
