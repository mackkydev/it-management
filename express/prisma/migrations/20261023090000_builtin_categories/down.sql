DROP INDEX `contract_categories_builtin_key_unique` ON `contract_categories`;
ALTER TABLE `contract_categories` DROP COLUMN `builtin_key`;
