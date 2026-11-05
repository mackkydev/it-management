-- ย้อนกลับ 20261130090000_policy_versions_others (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/policy ต้องลบแยก
DROP TABLE `other_policy_files`;
DROP TABLE `other_policies`;
ALTER TABLE `policy_files` DROP FOREIGN KEY `policy_files_version_foreign`, DROP INDEX `policy_files_version_index`, DROP COLUMN `version`;
ALTER TABLE `policy_versions` DROP FOREIGN KEY `policy_versions_created_by_foreign`, DROP INDEX `policy_versions_created_by_index`, DROP COLUMN `title`, DROP COLUMN `published_at`, DROP COLUMN `created_by`, DROP COLUMN `updated_at`;
