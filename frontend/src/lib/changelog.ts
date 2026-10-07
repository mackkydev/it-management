/**
 * ประวัติเวอร์ชันของ IT-SYSTEM — แหล่งเดียวของเลขเวอร์ชัน (แสดงที่โลโก้ + หน้า /about)
 * ระหว่างพัฒนาให้คงไว้ที่ 1.0.0 (ไม่ต้องเพิ่มรายการทุกครั้งที่แก้) — ออกเวอร์ชันจริงครั้งถัดไปจึงเพิ่ม release ใหม่ไว้ "บนสุด" แล้ว APP_VERSION จะเปลี่ยนตาม
 * ผู้ใช้ที่ใช้เวอร์ชันเก่าอยู่จะเห็นป้าย "ใหม่" ที่โลโก้จนกว่าจะเปิดหน้า /about (ผู้ใช้ครั้งแรกไม่มีป้าย)
 */
export type ChangeType = "new" | "improved" | "fixed" | "security";

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  changes: { type: ChangeType; th: string; en: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: "1.0.0",
    date: "2026-10-07",
    changes: [
      { type: "new", th: "ใบแจ้งงาน: แจ้งซ่อม/ติดตั้ง/ขอใช้บริการ สายอนุมัติ ติดตามสถานะ และพิมพ์ฟอร์ม A4", en: "Requests: repair / install / service tickets, approval routes, status tracking and A4 print form" },
      { type: "new", th: "สินทรัพย์ IT: ทะเบียนเครื่อง ผู้ถือครอง การโอนย้าย ประวัติซ่อม และ License", en: "IT assets: register, holders, movements, repair history and licenses" },
      { type: "new", th: "คลังบัญชี/รหัสผ่าน: เก็บแบบเข้ารหัส ยืนยันตัวตนก่อนเปิดดู และบันทึกประวัติการเปิดดู", en: "Password vault: encrypted storage, identity check before viewing and an access log" },
      { type: "new", th: "สัญญา vendor พร้อมแจ้งเตือนก่อนหมดอายุ", en: "Vendor contracts with expiry reminders" },
      { type: "new", th: "KPI ฝ่าย IT รายเดือน ดึงใบแจ้งงานอัตโนมัติ และส่งออก Excel", en: "Monthly IT KPI with tickets pulled in automatically and Excel export" },
      { type: "new", th: "ผู้ใช้ในระบบและผู้ใช้จาก API บทบาท และสิทธิ์การใช้งาน", en: "Local and API users, roles and permissions" },
      { type: "new", th: "ติดตั้งเป็นแอป (PWA) บนมือถือ/คอมพิวเตอร์", en: "Installable as an app (PWA)" },
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;

/** เทียบเวอร์ชันแบบ x.y.z → ลบ = a เก่ากว่า b */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * localStorage (เฉพาะเบราว์เซอร์นี้):
 * - seen = เวอร์ชันล่าสุดที่ผู้ใช้เปิดหน้า /about แล้ว
 * - prev = เวอร์ชันที่เคยเห็นก่อนหน้านั้น ("" = ไม่เคยเปิดเลย) — ใช้ติดป้าย "ใหม่" ให้ release ที่เพิ่งได้รับ
 */
const SEEN_KEY = "itsys.seen_version";
const PREV_KEY = "itsys.prev_seen_version";
const EVENT = "itsys:version-seen";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const readSeenVersion = () => read(SEEN_KEY);
export const readPrevSeenVersion = () => read(PREV_KEY);

/** ใช้กับ useSyncExternalStore — อัปเดตเมื่อเปิดหน้า /about (แท็บนี้หรือแท็บอื่น) */
export function subscribeSeenVersion(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** เปิดระบบครั้งแรกในเบราว์เซอร์นี้ → จำเวอร์ชันปัจจุบันไว้เงียบๆ (ไม่แจ้ง "ใหม่") เพื่อให้แจ้งได้เมื่อมีเวอร์ชันถัดไป */
export function initSeenVersion() {
  if (readSeenVersion() !== null) return;
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* โหมดส่วนตัว / ปิด storage — ข้ามได้ */
  }
}

export function markVersionSeen() {
  const seen = readSeenVersion();
  if (seen === APP_VERSION) return;
  try {
    localStorage.setItem(PREV_KEY, seen ?? "");
    localStorage.setItem(SEEN_KEY, APP_VERSION);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* โหมดส่วนตัว / ปิด storage — ข้ามได้ */
  }
}
