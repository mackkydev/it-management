ALTER TABLE `locations` DROP FOREIGN KEY `locations_branch_id_foreign`;
DROP INDEX `locations_branch_id_index` ON `locations`;
ALTER TABLE `locations` DROP COLUMN `branch_id`;
