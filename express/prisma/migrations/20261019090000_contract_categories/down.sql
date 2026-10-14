ALTER TABLE `contracts` DROP FOREIGN KEY `contracts_category_id_foreign`;
DROP INDEX `contracts_category_id_index` ON `contracts`;
ALTER TABLE `contracts` DROP COLUMN `category_id`;
DROP TABLE `contract_categories`;
