/**
 * อ่านค่าจาก JSON ของระบบต้นทางด้วย dot path ที่ปลอดภัย เช่น "data.access_token", "items.0.id"
 * - ไม่ใช้ eval / ไม่รองรับ expression ใด ๆ — เดินตาม key ทีละชั้นเท่านั้น
 * - อ่านเฉพาะ own property (กัน __proto__ / constructor / prototype)
 */
export const PATH_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export function isValidPath(path: string): boolean {
  return path.length <= 255 && PATH_PATTERN.test(path) && !path.split(".").some((k) => FORBIDDEN.has(k));
}

export function readPath(data: unknown, path: string | null | undefined): unknown {
  if (!path) return data;
  if (!isValidPath(path)) return undefined;
  let cur: unknown = data;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(key)) return undefined;
      cur = cur[Number(key)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

/** ค่า scalar เป็นข้อความ (string / number) — อย่างอื่น = null */
export function readString(data: unknown, path: string | null | undefined): string | null {
  const v = readPath(data, path);
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
