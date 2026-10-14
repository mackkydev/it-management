-- หมวดตั้งต้น (แก้ไม่ได้, แปลตามภาษา): คลังบัญชีเพิ่ม computer / hosting / hostname เป็นหมวดตั้งต้นในโค้ด
-- → เอา 3 ชื่อนี้ออกจากหมวดที่เพิ่มเอง (ใส่ไว้ใน migration ก่อนหน้า) และบัญชีที่ใช้ชื่อไทยเดิมเปลี่ยนเป็น key
UPDATE `credentials` SET `category` = 'computer' WHERE `category` = 'คอมพิวเตอร์';
UPDATE `credentials` SET `category` = 'hosting' WHERE `category` = 'Hosting';
UPDATE `credentials` SET `category` = 'hostname' WHERE `category` = 'Hostname';
DELETE FROM `dropdown_options` WHERE `list` = 'vault_category' AND `name` IN ('คอมพิวเตอร์', 'Hosting', 'Hostname', 'computer', 'hosting', 'hostname');

-- หมวดหมู่สัญญา: หมวดตั้งต้นชุดเดียวกับคลังบัญชี (builtin_key = key ของหมวด — แก้/ลบไม่ได้, ชื่อที่แสดงแปลตามภาษา)
ALTER TABLE `contract_categories` ADD COLUMN `builtin_key` VARCHAR(30) NULL;
CREATE UNIQUE INDEX `contract_categories_builtin_key_unique` ON `contract_categories`(`builtin_key`);
UPDATE `contract_categories` SET `builtin_key` = 'system' WHERE `name` = 'ระบบงาน';
UPDATE `contract_categories` SET `builtin_key` = 'server' WHERE `name` = 'เซิร์ฟเวอร์';
UPDATE `contract_categories` SET `builtin_key` = 'network' WHERE `name` = 'เครือข่าย';
UPDATE `contract_categories` SET `builtin_key` = 'email' WHERE `name` = 'อีเมล';
UPDATE `contract_categories` SET `builtin_key` = 'software' WHERE `name` = 'ซอฟต์แวร์/License';
UPDATE `contract_categories` SET `builtin_key` = 'cloud' WHERE `name` = 'Cloud';
UPDATE `contract_categories` SET `builtin_key` = 'computer' WHERE `name` = 'คอมพิวเตอร์';
UPDATE `contract_categories` SET `builtin_key` = 'hosting' WHERE `name` = 'Hosting';
UPDATE `contract_categories` SET `builtin_key` = 'hostname' WHERE `name` = 'Hostname';
UPDATE `contract_categories` SET `builtin_key` = 'other' WHERE `name` = 'อื่นๆ';
-- เครื่องที่ยังไม่มี (ติดตั้งใหม่ / ลบไปแล้ว) — เพิ่มให้ครบ
INSERT IGNORE INTO `contract_categories` (`name`, `builtin_key`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('ระบบงาน', 'system', true, 1, NOW(), NOW()),
  ('เซิร์ฟเวอร์', 'server', true, 2, NOW(), NOW()),
  ('เครือข่าย', 'network', true, 3, NOW(), NOW()),
  ('อีเมล', 'email', true, 4, NOW(), NOW()),
  ('ซอฟต์แวร์/License', 'software', true, 5, NOW(), NOW()),
  ('Cloud', 'cloud', true, 6, NOW(), NOW()),
  ('คอมพิวเตอร์', 'computer', true, 7, NOW(), NOW()),
  ('Hosting', 'hosting', true, 8, NOW(), NOW()),
  ('Hostname', 'hostname', true, 9, NOW(), NOW()),
  ('อื่นๆ', 'other', true, 99, NOW(), NOW());
