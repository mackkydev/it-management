-- ข้อมูล Drop Down ที่แก้ได้ (เมนู ข้อมูลหลัก → ข้อมูล Drop Down): Computer Type / ยี่ห้อ / หมวดหมู่คลังบัญชี (ที่เพิ่มเอง)
-- ค่าที่เลือกยังเก็บเป็นข้อความในตารางเดิม (assets.computer_type / assets.brand / credentials.category) — เปลี่ยนชื่อที่นี่ = อัปเดตข้อมูลเดิมตาม
CREATE TABLE `dropdown_options` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `list` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `dropdown_options_list_name_unique`(`list`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- ค่าตั้งต้น: Computer Type เดิมของฟอร์ม + ค่าที่มีในทะเบียนแล้ว
INSERT INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('computer_type', 'Desktop', 1, NOW(), NOW()),
  ('computer_type', 'Laptop', 2, NOW(), NOW()),
  ('computer_type', 'All-in-One', 3, NOW(), NOW()),
  ('computer_type', 'Server', 4, NOW(), NOW()),
  ('computer_type', 'Tablet', 5, NOW(), NOW());
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`)
  SELECT DISTINCT 'computer_type', TRIM(`computer_type`), 10, NOW(), NOW() FROM `assets` WHERE `computer_type` IS NOT NULL AND TRIM(`computer_type`) <> '';
-- ยี่ห้อที่มีในทะเบียนสินทรัพย์
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`)
  SELECT DISTINCT 'brand', TRIM(`brand`), 0, NOW(), NOW() FROM `assets` WHERE `brand` IS NOT NULL AND TRIM(`brand`) <> '' AND CHAR_LENGTH(TRIM(`brand`)) <= 100;
-- หมวดหมู่คลังบัญชีที่ผู้ใช้เพิ่มเอง (หมวดตั้งต้น system/server/... อยู่ในโค้ด แปลตามภาษา)
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`)
  SELECT DISTINCT 'vault_category', TRIM(`category`), 0, NOW(), NOW() FROM `credentials`
   WHERE `category` NOT IN ('system', 'server', 'network', 'email', 'software', 'cloud', 'other') AND TRIM(`category`) <> '';
