-- ย้อนกลับ 20261121090000_asset_shared_categories (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
-- สินทรัพย์ส่วนกลางกลับเป็นข้อความผู้ใช้งาน "ส่วนกลาง"; หมวดที่เพิ่มเองหายจากรายการ แต่ค่าใน assets.category คงไว้
DELETE FROM `dropdown_options` WHERE `list` = 'asset_category';
ALTER TABLE `assets` DROP COLUMN `is_shared`;
