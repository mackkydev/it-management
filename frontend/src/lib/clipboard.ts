/** ล้าง clipboard หลังคัดลอกข้อมูลลับ (รหัสผ่านคลังบัญชี / license key) — มิลลิวินาที */
export const SECRET_CLIPBOARD_MS = 30_000;

let clearTimer: number | undefined;

/**
 * คัดลอกข้อมูลลับ แล้วล้าง clipboard อัตโนมัติใน 30 วินาที (เขียนค่าว่างทับ — ทำงานเมื่อหน้ายังเปิดอยู่)
 * คัดลอกซ้ำ = เริ่มนับใหม่; ล้างไม่ได้ (เช่น หน้าต่างไม่ได้โฟกัส) ก็ข้ามไปเงียบๆ
 */
export async function copySecret(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    navigator.clipboard.writeText("").catch(() => {});
  }, SECRET_CLIPBOARD_MS);
}
