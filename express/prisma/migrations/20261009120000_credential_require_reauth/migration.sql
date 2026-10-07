-- คลังบัญชี: ต้องยืนยันตัวตน (รหัสผ่าน login / PIN กลาง) ก่อนเปิดดูรหัสของบัญชีนี้หรือไม่ — ค่าเริ่มต้น = ต้องยืนยัน
ALTER TABLE `credentials` ADD COLUMN `require_reauth` BOOLEAN NOT NULL DEFAULT TRUE;
