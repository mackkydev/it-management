/**
 * สไตล์ปุ่ม/ช่องกรอก/ตาราง — ใช้ token สีจาก globals.css จึงเปลี่ยนตามธีม (accent-*) และโหมดมืดอัตโนมัติ
 * ตัวอักษรใช้เฉดเข้มบนพื้นอ่อนในโหมดสว่าง และเฉดอ่อนบนพื้นโปร่งแสงในโหมดมืด เพื่อให้อ่านง่ายทั้งสองโหมด
 */
/** ทุกปุ่ม/ลิงก์ที่กดได้ต้องมี cursor-pointer (กฎใน CLAUDE.md) — disabled เป็น cursor-not-allowed */
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const btn = {
  /** ปุ่มหลัก: บันทึก / ค้นหา / เพิ่ม */
  primary:
    `${BASE} bg-accent-200 text-accent-900 hover:bg-accent-300 focus-visible:ring-accent-300 ` +
    "dark:bg-accent-400/20 dark:text-accent-200 dark:hover:bg-accent-400/30",
  /** ปุ่มรอง: ยกเลิก / ล้างตัวกรอง / เปลี่ยนหน้า */
  secondary: `${BASE} bg-surface text-ink ring-1 ring-inset ring-line hover:bg-subtle focus-visible:ring-accent-300`,
  /** ปุ่มแก้ไข */
  soft:
    `${BASE} bg-accent-100 text-accent-800 hover:bg-accent-200 focus-visible:ring-accent-300 ` +
    "dark:bg-accent-400/10 dark:text-accent-300 dark:hover:bg-accent-400/20",
  /** ปุ่มลบ */
  danger:
    `${BASE} bg-danger-100 text-danger-700 hover:bg-danger-200 focus-visible:ring-danger-300 ` +
    "dark:bg-danger-400/15 dark:text-danger-300 dark:hover:bg-danger-400/25",
  /** ปุ่มขนาดเล็ก (ใช้ต่อท้าย variant) */
  sm: "px-3 py-1.5 text-xs",
};

export const input =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors " +
  "placeholder:text-faint focus:border-accent-300 focus:ring-2 focus:ring-accent-100 " +
  "dark:focus:border-accent-400/60 dark:focus:ring-accent-400/20";

/** รูปแบบ error ของช่องกรอก (กรอบแดง + ข้อความแดงใต้ช่อง) — คงไว้ตามมาตรฐานเดิม */
export const inputError = "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20";

/** การ์ด / กล่องเนื้อหา */
export const card = "rounded-2xl bg-surface ring-1 ring-line";

/** ตาราง: หัวตารางพื้นอ่อน, แถวสลับสีจางๆ, hover เป็นสีธีม — โหมดมืดใช้พื้นโปร่งแสงให้ดูนุ่มตา */
export const table = {
  wrap: "overflow-x-auto rounded-2xl bg-surface ring-1 ring-line",
  table: "min-w-full divide-y divide-line text-sm",
  head: "bg-subtle text-left text-xs font-semibold uppercase tracking-wide text-muted",
  th: "px-4 py-3",
  body: "divide-y divide-line-soft",
  row: "transition-colors even:bg-subtle/40 hover:bg-accent-50 dark:even:bg-white/[0.02] dark:hover:bg-accent-400/[0.07]",
  td: "px-4 py-3",
};

/**
 * สีความหมายของระบบ: success / info / warning / danger / idle
 * เป็น token จาก globals.css ที่ "เปลี่ยนตามธีม" — ธีมไหนสีหลักชนกับสถานะ สถานะนั้นจะสลับเป็นเฉดอื่นอัตโนมัติ
 * (เช่น ธีมมิ้นต์ → "ใช้งาน" เป็นเขียวมะนาว, ธีมฟ้า → "เก็บในคลัง" เป็นม่วง)
 */
export const tone = {
  success: { badge: "bg-success-100 text-success-800 dark:bg-success-400/15 dark:text-success-300", dot: "bg-success-400", icon: "text-success-500" },
  info: { badge: "bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300", dot: "bg-info-400", icon: "text-info-500" },
  warning: { badge: "bg-warning-100 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300", dot: "bg-warning-400", icon: "text-warning-500" },
  danger: { badge: "bg-danger-100 text-danger-800 dark:bg-danger-400/15 dark:text-danger-300", dot: "bg-danger-400", icon: "text-danger-400" },
  idle: { badge: "bg-idle-100 text-idle-700 dark:bg-idle-400/15 dark:text-idle-300", dot: "bg-idle-400", icon: "text-idle-400" },
} as const;

/** ป้ายสถานะ: [พื้น + ตัวอักษร, จุดสี] */
export const statusStyle: Record<string, [string, string]> = {
  active: [tone.success.badge, tone.success.dot],
  in_storage: [tone.info.badge, tone.info.dot],
  in_repair: [tone.warning.badge, tone.warning.dot],
  lost: [tone.danger.badge, tone.danger.dot],
  disposed: [tone.idle.badge, tone.idle.dot],
};

/** แถบแจ้งเตือน */
export const alert = {
  success: "flex items-center gap-2 rounded-xl bg-success-50 px-4 py-3 text-sm text-success-800 ring-1 ring-success-100 dark:bg-success-400/10 dark:text-success-300 dark:ring-success-400/20",
  error: "flex items-center gap-2 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100 dark:bg-danger-400/10 dark:text-danger-300 dark:ring-danger-400/20",
  warning: "rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-400/10 dark:text-warning-300",
  info: "rounded-xl bg-accent-50 p-3 ring-1 ring-accent-100 dark:bg-accent-400/10 dark:ring-accent-400/20",
};
