-- ประวัติการโอนย้ายเก็บสาขา (ปุ่ม "โอนย้าย" = เปลี่ยนสาขา + ผู้ถือครอง/ผู้ใช้งาน)
ALTER TABLE `asset_movements` ADD COLUMN `from_branch_id` BIGINT NULL, ADD COLUMN `to_branch_id` BIGINT NULL;
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_from_branch_id_foreign` FOREIGN KEY (`from_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `asset_movements` ADD CONSTRAINT `asset_movements_to_branch_id_foreign` FOREIGN KEY (`to_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- ยกเลิกสัญญา License ซอฟต์แวร์ (จัดการสัญญา: ต่อสัญญาแล้ว / ยกเลิกสัญญา) — ยกเลิกแล้วไม่นับเป็น "กำลังจะหมดอายุ" และไม่แจ้งเตือน
ALTER TABLE `asset_licenses` ADD COLUMN `cancelled_at` DATETIME NULL, ADD COLUMN `cancelled_by` BIGINT NULL, ADD COLUMN `cancel_reason` VARCHAR(500) NULL;
ALTER TABLE `asset_licenses` ADD CONSTRAINT `asset_licenses_cancelled_by_foreign` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
