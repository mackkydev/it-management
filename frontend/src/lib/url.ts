/**
 * ลิงก์เปิดหน้าจัดการอุปกรณ์ผ่านเว็บเบราว์เซอร์ จากช่อง "URL / Host / IP" ของคลังบัญชี
 *   "https://printer.local/admin" → ใช้ตามนั้น
 *   "192.168.1.50" / "192.168.1.50:8080" / "nas.local/admin" → เติม http:// (อุปกรณ์ในเครือข่ายส่วนใหญ่เปิดหน้าเว็บแบบ http)
 * คืน null เมื่อเปิดในเบราว์เซอร์ไม่ได้ (เช่น ssh://, rdp://, ข้อความมีช่องว่าง)
 * อนุญาตเฉพาะ http/https — กันลิงก์ javascript: / data: ที่ถูกบันทึกไว้ในคลังรหัสผ่าน
 */
const HOST = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?([/?#]\S*)?$/i;

export function panelHref(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : HOST.test(value) && (value.includes(".") || value.includes(":")) ? `http://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
