-- ระบบสิทธิ์ใหม่: ผู้ดูแลระบบ (super_admin) / ผู้ดูแลระบบรอง (admin) + กลุ่มสิทธิ์หลายกลุ่มต่อคน + วันหมดอายุ
-- เพิ่มอย่างเดียว (additive) — ย้อนกลับด้วย down.sql

-- AlterTable: สิทธิ์รายคนใช้ได้ถึงวันที่ (null = ไม่หมดอายุ)
ALTER TABLE `user_permissions` ADD COLUMN `expires_on` DATE NULL;

-- CreateTable
CREATE TABLE `permission_groups` (
    `key` VARCHAR(20) NOT NULL,
    `name_th` VARCHAR(100) NOT NULL,
    `name_en` VARCHAR(100) NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `user_groups` (
    `user_id` BIGINT NOT NULL,
    `group_key` VARCHAR(20) NOT NULL,
    `expires_on` DATE NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    INDEX `user_groups_group_key_index`(`group_key`),
    INDEX `user_groups_created_by_index`(`created_by`),
    PRIMARY KEY (`user_id`, `group_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_group_key_foreign` FOREIGN KEY (`group_key`) REFERENCES `permission_groups`(`key`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `user_groups` ADD CONSTRAINT `user_groups_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- ข้อมูลตั้งต้น: กลุ่มตามตำแหน่ง (ลบไม่ได้) + กลุ่มฝ่าย IT เดิม (กลุ่มที่สร้างเอง — แก้/ลบได้, key เดิมจึงใช้สิทธิ์ใน role_permissions ต่อได้ทันที)
INSERT INTO `permission_groups` (`key`, `name_th`, `name_en`, `is_system`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('super_admin', 'ผู้ดูแลระบบ', 'Super admin', true, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('admin', 'ผู้ดูแลระบบรอง', 'Admin', true, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('division_manager', 'ผู้จัดการฝ่าย', 'Division manager', true, 2, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('manager', 'ผู้จัดการ', 'Manager', true, 3, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('viewer', 'พนักงาน', 'Staff', true, 4, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('it_staff', 'เจ้าหน้าที่ IT (เดิม)', 'IT staff (legacy)', false, 10, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('it_head', 'หัวหน้า IT (เดิม)', 'IT head (legacy)', false, 11, UTC_TIMESTAMP(), UTC_TIMESTAMP());

-- ผู้ดูแลระบบเดิม (Local Admin = admin + LOCAL) → super_admin (ผ่านทุกสิทธิ์เหมือนเดิม)
UPDATE `users` SET `role` = 'super_admin' WHERE `role` = 'admin' AND `type` = 'LOCAL';

-- ตำแหน่ง "เจ้าหน้าที่ IT" เลิกใช้ → พนักงาน (ช่อง "เจ้าหน้าที่ IT" = หน้าที่ในใบแจ้งงาน คงไว้)
UPDATE `users` SET `role` = 'viewer', `is_it_staff` = true WHERE `role` = 'it_staff';

-- สิทธิ์ที่เคยได้จาก flag ฝ่าย IT → สมาชิกกลุ่มฝ่าย IT เดิม (flag ไม่ให้สิทธิ์อีกต่อไป)
INSERT INTO `user_groups` (`user_id`, `group_key`, `created_at`) SELECT `id`, 'it_staff', UTC_TIMESTAMP() FROM `users` WHERE `is_it_staff` = true;
INSERT INTO `user_groups` (`user_id`, `group_key`, `created_at`) SELECT `id`, 'it_head', UTC_TIMESTAMP() FROM `users` WHERE `is_it_head` = true;

-- ผู้ดูแลระบบรอง = ทุกสิทธิ์ที่มีอยู่ (สิทธิ์ที่สงวนไว้ — จัดการสิทธิ์ / การเชื่อมต่อ API — เป็น key ใหม่ที่ admin ไม่ได้ตั้งแต่ต้น)
INSERT IGNORE INTO `role_permissions` (`role`, `permission_id`, `created_at`) SELECT 'admin', `id`, UTC_TIMESTAMP() FROM `permissions`;
