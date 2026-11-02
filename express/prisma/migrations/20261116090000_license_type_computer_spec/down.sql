-- ย้อนกลับ 20261116090000_license_type_computer_spec (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ประเภท license และสเปคคอมพิวเตอร์หายไป
ALTER TABLE `assets` DROP COLUMN `computer_spec`;
ALTER TABLE `asset_licenses` DROP COLUMN `software_type`;
DELETE FROM `dropdown_options` WHERE `list` = 'computer_spec';
