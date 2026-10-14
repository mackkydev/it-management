-- สถานที่สังกัดสาขา (ไม่บังคับ) — แยกสถานที่ของแต่ละสาขาให้ชัดเจน; ลบสาขา = สถานที่ไม่ระบุสาขา
ALTER TABLE `locations` ADD COLUMN `branch_id` BIGINT NULL;
CREATE INDEX `locations_branch_id_index` ON `locations`(`branch_id`);
ALTER TABLE `locations` ADD CONSTRAINT `locations_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
