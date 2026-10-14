-- ย้อนกลับ 20261015090000_department_division (รันด้วย mysql client เอง)
ALTER TABLE `departments` DROP FOREIGN KEY `departments_division_id_foreign`;
ALTER TABLE `departments` DROP INDEX `departments_division_id_index`;
ALTER TABLE `departments` DROP COLUMN `division_id`;
