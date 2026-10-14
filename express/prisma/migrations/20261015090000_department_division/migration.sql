-- แผนกสังกัดฝ่าย (ไม่บังคับ — แผนกที่ไม่อยู่ใต้ฝ่ายใดเว้นว่างได้) — ลบฝ่าย = แผนกหลุดจากฝ่าย (SET NULL)
ALTER TABLE `departments` ADD COLUMN `division_id` BIGINT NULL;
CREATE INDEX `departments_division_id_index` ON `departments`(`division_id`);
ALTER TABLE `departments` ADD CONSTRAINT `departments_division_id_foreign` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
