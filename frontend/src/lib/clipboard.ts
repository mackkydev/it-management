import { clipboardClearSeconds } from "@/app/actions/secrets";

/** ใช้เมื่ออ่านค่าที่ตั้งไว้ไม่ได้ */
const DEFAULT_SECONDS = 30;

let clearTimer: number | undefined;

/**
 * คัดลอกข้อมูลลับ แล้วล้าง clipboard อัตโนมัติตามเวลาที่ตั้งในระบบ (เขียนค่าว่างทับ — ทำงานเมื่อหน้ายังเปิดอยู่) — คืนจำนวนวินาที
 * คัดลอกก่อนแล้วจึงถามเวลา (เบราว์เซอร์อนุญาตเขียน clipboard เฉพาะตอนผู้ใช้กด); คัดลอกซ้ำ = เริ่มนับใหม่; ล้างไม่ได้ (เช่น หน้าต่างไม่ได้โฟกัส) ก็ข้ามไปเงียบๆ
 */
export async function copySecret(text: string): Promise<number> {
  await navigator.clipboard.writeText(text);
  const seconds = await clipboardClearSeconds().catch(() => DEFAULT_SECONDS);
  window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    navigator.clipboard.writeText("").catch(() => {});
  }, seconds * 1000);
  return seconds;
}
