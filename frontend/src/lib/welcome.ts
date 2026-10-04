/**
 * cookie บอกว่าเพิ่ง login — layout แสดงหน้าต่างสรุปการแจ้งเตือน/งานรออนุมัติครั้งเดียว แล้ว client ลบทิ้ง
 * ไม่ใช่ข้อมูลลับ จึงไม่เป็น httpOnly (client ต้องลบเองได้)
 */
export const WELCOME_COOKIE = "eam_welcome";
