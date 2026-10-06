-- ย้อนกลับ 20261005150000_add_asset_computer_fields (รันด้วย mysql client เอง)
ALTER TABLE `assets` DROP FOREIGN KEY `assets_branch_id_foreign`;
DROP INDEX `assets_branch_id_index` ON `assets`;
ALTER TABLE `assets`
  DROP COLUMN `antivirus`, DROP COLUMN `branch_id`, DROP COLUMN `computer_type`, DROP COLUMN `cpu_tag`, DROP COLUMN `department`,
  DROP COLUMN `email_365`, DROP COLUMN `ip_address`, DROP COLUMN `mac_address`, DROP COLUMN `monitor_tag`, DROP COLUMN `notebook_tag`,
  DROP COLUMN `office`, DROP COLUMN `os`, DROP COLUMN `received_date`, DROP COLUMN `start_use_date`, DROP COLUMN `user_name`, DROP COLUMN `work_group`;
DROP INDEX `branches_work_group_unique` ON `branches`;
ALTER TABLE `branches` DROP COLUMN `work_group`;
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261005150000_add_asset_computer_fields';
