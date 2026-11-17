-- ย้อนกลับ: ลบตัวย่อ / ชื่ออังกฤษของฝ่ายและแผนก
ALTER TABLE `departments` DROP INDEX `departments_code_unique`, DROP COLUMN `name_en`, DROP COLUMN `code`;
ALTER TABLE `divisions` DROP INDEX `divisions_code_unique`, DROP COLUMN `name_en`, DROP COLUMN `code`;
