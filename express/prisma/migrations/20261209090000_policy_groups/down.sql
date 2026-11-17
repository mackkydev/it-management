-- ย้อนกลับ 20261209090000_policy_groups (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
-- หมายเหตุ: app_settings.system_policy.version/sections ไม่ได้ถูกแก้โดย migration นี้ — ถ้าตั้งฉบับที่แสดงใหม่หลังจากนี้ ให้ตั้งค่าเดิมกลับเองที่ app_settings
ALTER TABLE `other_policies` DROP COLUMN `sections`;
ALTER TABLE `policy_groups` DROP FOREIGN KEY `policy_groups_current_version_foreign`;
ALTER TABLE `policy_versions` DROP FOREIGN KEY `policy_versions_group_id_foreign`, DROP INDEX `policy_versions_group_id_index`, DROP COLUMN `group_id`;
DROP TABLE `policy_groups`;
