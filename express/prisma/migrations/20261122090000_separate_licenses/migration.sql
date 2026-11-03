-- แยก License ออกจากสินทรัพย์ — ตารางของตัวเอง เลขที่ทรัพย์สินไม่บังคับ
-- id เท่ากับ assets.id เดิม ประวัติ (audit_logs) จึงตามหาได้ และ uuid เดิม ลิงก์ /licenses/{id} จึงไม่เปลี่ยน
CREATE TABLE `licenses` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL,
  `license_no` VARCHAR(50) NULL,
  `name` VARCHAR(255) NOT NULL,
  `brand` VARCHAR(100) NULL,
  `model` VARCHAR(100) NULL,
  `serial_number` VARCHAR(100) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `location_id` BIGINT NULL,
  `branch_id` BIGINT NULL,
  `purchase_date` DATE NULL,
  `purchase_cost` DECIMAL(15, 2) NULL,
  `notes` TEXT NULL,
  `software_type` VARCHAR(20) NOT NULL DEFAULT 'other',
  `billing` VARCHAR(20) NOT NULL,
  `start_date` DATE NOT NULL,
  `expires_at` DATE NULL,
  `seats` INT NULL,
  `vendor` VARCHAR(255) NULL,
  `license_key` TEXT NULL,
  `notify_days_before` SMALLINT NULL,
  `notified_for_expires_at` DATE NULL,
  `cancelled_at` DATETIME(0) NULL,
  `cancelled_by` BIGINT NULL,
  `cancel_reason` VARCHAR(500) NULL,
  `created_by` BIGINT NULL,
  `updated_by` BIGINT NULL,
  `created_at` DATETIME(0) NULL,
  `updated_at` DATETIME(0) NULL,
  `deleted_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `licenses_uuid_unique` (`uuid`),
  UNIQUE INDEX `licenses_license_no_unique` (`license_no`),
  INDEX `licenses_expires_at_index` (`expires_at`),
  INDEX `licenses_name_index` (`name`),
  CONSTRAINT `licenses_location_id_foreign` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `licenses_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `licenses_cancelled_by_foreign` FOREIGN KEY (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `licenses_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `licenses_updated_by_foreign` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `license_files` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `license_id` BIGINT NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'license',
  `original_name` VARCHAR(255) NOT NULL,
  `path` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(100) NOT NULL,
  `size` INT NOT NULL,
  `uploaded_by` BIGINT NULL,
  `created_at` DATETIME(0) NULL,
  `updated_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  INDEX `license_files_license_id_index` (`license_id`),
  CONSTRAINT `license_files_license_id_foreign` FOREIGN KEY (`license_id`) REFERENCES `licenses` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `license_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- สถานะชุดใหม่: ใช้งาน / เลิกใช้งาน / สูญหาย / จำหน่ายออก
INSERT INTO `licenses` (`id`, `uuid`, `license_no`, `name`, `brand`, `model`, `serial_number`, `status`, `location_id`, `branch_id`, `purchase_date`, `purchase_cost`, `notes`,
    `software_type`, `billing`, `start_date`, `expires_at`, `seats`, `vendor`, `license_key`, `notify_days_before`, `notified_for_expires_at`, `cancelled_at`, `cancelled_by`, `cancel_reason`,
    `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`)
SELECT a.`id`, a.`uuid`, a.`asset_tag`, a.`name`, a.`brand`, a.`model`, a.`serial_number`,
    CASE WHEN a.`status` IN ('active', 'lost', 'disposed') THEN a.`status` ELSE 'inactive' END,
    a.`location_id`, a.`branch_id`, a.`purchase_date`, a.`purchase_cost`, a.`notes`,
    li.`software_type`, li.`billing`, li.`start_date`, li.`expires_at`, li.`seats`, li.`vendor`, li.`license_key`, li.`notify_days_before`, li.`notified_for_expires_at`, li.`cancelled_at`, li.`cancelled_by`, li.`cancel_reason`,
    a.`created_by`, a.`updated_by`, a.`created_at`, a.`updated_at`, a.`deleted_at`
  FROM `assets` a JOIN `asset_licenses` li ON li.`asset_id` = a.`id`
 WHERE a.`category` = 'SOFTWARE';

-- ไฟล์ชี้ path เดิม ไม่ย้ายไฟล์จริง
INSERT INTO `license_files` (`license_id`, `kind`, `original_name`, `path`, `mime`, `size`, `uploaded_by`, `created_at`, `updated_at`)
SELECT f.`asset_id`, f.`kind`, f.`original_name`, f.`path`, f.`mime`, f.`size`, f.`uploaded_by`, f.`created_at`, f.`updated_at`
  FROM `asset_files` f JOIN `licenses` l ON l.`id` = f.`asset_id`;

-- การติดตั้งชี้ตารางใหม่ — license_asset_id เดิมคงค่าไว้ แถวใหม่ไม่มีค่านี้จึงต้องว่างได้
ALTER TABLE `license_installations` MODIFY `license_asset_id` BIGINT NULL, ADD COLUMN `license_id` BIGINT NULL;
UPDATE `license_installations` i JOIN `licenses` l ON l.`id` = i.`license_asset_id` SET i.`license_id` = l.`id`;
ALTER TABLE `license_installations`
  ADD INDEX `license_installations_license_id_active_index` (`license_id`, `uninstalled_at`),
  ADD CONSTRAINT `license_installations_license_id_foreign` FOREIGN KEY (`license_id`) REFERENCES `licenses` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- รายการเดิมในสินทรัพย์: ซ่อน (ไม่ลบแถว) — asset_licenses / asset_files เดิมคงไว้เป็นสำรอง
UPDATE `assets` SET `deleted_at` = UTC_TIMESTAMP() WHERE `category` = 'SOFTWARE' AND `deleted_at` IS NULL;
