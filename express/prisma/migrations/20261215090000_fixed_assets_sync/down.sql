-- ย้อนกลับ: ลบตาราง Fixed Assets ทั้งหมด (ข้อมูลเป็นสำเนาจาก SyteLine ดึงใหม่ได้) + ค่าตั้งค่า
DROP TABLE IF EXISTS `fixed_asset_sync_runs`;
DROP TABLE IF EXISTS `fixed_asset_classdepts`;
DROP TABLE IF EXISTS `fixed_assets`;
DELETE FROM `app_settings` WHERE `key` = 'fixed_asset_sync';
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261215090000_fixed_assets_sync';
