-- ทะเบียนคอมพิวเตอร์: Software อื่นๆ ที่ยังไม่ผูก license (นำเข้า Excel แล้วไม่ตรงชื่อ License ในระบบ หรือ seat เต็ม) — เก็บเป็นข้อความ
ALTER TABLE `assets` ADD COLUMN `other_software` VARCHAR(1000) NULL;
