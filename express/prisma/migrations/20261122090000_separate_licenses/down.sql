-- ย้อนกลับ 20261122090000_separate_licenses (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
-- License ที่เพิ่มหลัง migration (ไม่มีแถวใน assets) และการติดตั้งของมันจะหายไป; การแก้ไขหลัง migration ไม่ย้อนกลับไปตารางเดิม
UPDATE `assets` a JOIN `licenses` l ON l.`id` = a.`id` SET a.`deleted_at` = l.`deleted_at` WHERE a.`category` = 'SOFTWARE';
DELETE FROM `license_installations` WHERE `license_asset_id` IS NULL;
ALTER TABLE `license_installations` DROP FOREIGN KEY `license_installations_license_id_foreign`, DROP INDEX `license_installations_license_id_active_index`, DROP COLUMN `license_id`;
ALTER TABLE `license_installations` MODIFY `license_asset_id` BIGINT NOT NULL;
DROP TABLE `license_files`;
DROP TABLE `licenses`;
