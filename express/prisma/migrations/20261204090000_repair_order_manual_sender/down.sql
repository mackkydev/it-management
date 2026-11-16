-- ย้อนกลับ: แถวที่พิมพ์ชื่อเอง (ไม่มี sent_by_id) ใช้ผู้บันทึกแทน
UPDATE `repair_orders` SET `sent_by_id` = `created_by` WHERE `sent_by_id` IS NULL;
ALTER TABLE `repair_orders` MODIFY `sent_by_id` BIGINT NOT NULL;
ALTER TABLE `repair_orders` DROP COLUMN `sender_name`;
