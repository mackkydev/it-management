-- จอง ZOOM: ผู้จองยกเลิกหลังฝ่าย IT ส่งลิงก์แล้ว → ฝ่าย IT ยกเลิกห้องประชุมในระบบ ZOOM แล้วกดยืนยัน (ว่าง = ยังรอยกเลิกลิงก์)
ALTER TABLE `zoom_bookings` ADD COLUMN `link_removed_at` DATETIME(0) NULL, ADD COLUMN `link_removed_by` BIGINT NULL;
