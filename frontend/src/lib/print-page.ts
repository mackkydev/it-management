/**
 * การตั้งหน้ากระดาษตอนพิมพ์ / บันทึก PDF — ทุกเอกสารต้องใช้จากไฟล์นี้ ห้ามเขียน CSS สำหรับกำหนดหน้ากระดาษเอง (ESLint กันไว้, กฎใน CLAUDE.md)
 * เอกสารที่พิมพ์ต้องไม่มีวันเวลา ชื่อหน้า หรือ URL ที่เบราว์เซอร์ใส่เอง แสดงได้เฉพาะเลขหน้า
 */

/**
 * เอกสารที่ยาวได้หลายหน้า: ขอบ 15mm + เลขหน้ากึ่งกลางล่าง
 * ต้องประกาศกล่องขอบกระดาษว่างครบทุกตำแหน่ง — ถ้าไม่ครบ Chrome / Edge ยังใส่ชื่อหน้าในตำแหน่งที่เหลือ (ทดสอบจาก PDF จริงแล้ว)
 */
export const DOCUMENT_PRINT_CSS = `
@page {
  size: A4;
  margin: 15mm;
  @top-left { content: ""; }
  @top-center { content: ""; }
  @top-right { content: ""; }
  @bottom-left { content: ""; }
  @bottom-right { content: ""; }
  @bottom-center { content: counter(page); font-size: 9pt; color: #555; }
}
@media print {
  .no-print { display: none !important; }
}`;

/**
 * แบบฟอร์มเต็มแผ่นกระดาษ 1 แผ่น (ใบแจ้งงาน, ใบขอสิทธิ์ — กำหนดขนาด 210 x 297mm และระยะขอบเอง):
 * ไม่มีขอบกระดาษ เบราว์เซอร์จึงไม่มีที่ใส่ข้อความ และไม่ใส่เลขหน้าเพราะจะดันแบบฟอร์มล้นไปหน้าใหม่
 * ซ่อนทุกอย่างใน body ยกเว้น modal ของเอกสาร (portal เป็นลูกตรงของ body) — ใช้เฉพาะตอน modal เปิดอยู่
 */
export const SHEET_PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.ticket-print-root) { display: none !important; }
}`;
