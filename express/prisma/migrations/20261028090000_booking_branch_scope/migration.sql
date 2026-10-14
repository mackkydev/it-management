-- ขอบเขตห้องประชุม/รถตามสาขา (app_settings.booking_scope) + ย้ายรถข้ามสาขา
-- AlterTable: สาขาที่ขอใช้รถ (ผู้จัดคิวของสาขานี้เลือกรถเมื่อยังไม่ระบุรถ)
ALTER TABLE `vehicle_bookings` ADD COLUMN `branch_id` BIGINT NULL;

-- ข้อมูลเดิม: สาขาของรถที่จอง ไม่มี (ใช้ร่วมกัน / ยังไม่ระบุรถ) = สาขาของผู้จอง
UPDATE `vehicle_bookings` m
  LEFT JOIN `vehicles` v ON v.`id` = m.`vehicle_id`
  LEFT JOIN `users` u ON u.`id` = m.`user_id`
  SET m.`branch_id` = COALESCE(v.`branch_id`, u.`branch_id`);

-- รถ: ประเภทรถ / ประเภทเชื้อเพลิง (ข้อความจากข้อมูล Drop Down list vehicle_type / vehicle_fuel) — ชื่อซ้ำที่มีอยู่แล้ว = ข้าม
ALTER TABLE `vehicles` ADD COLUMN `vehicle_type` VARCHAR(50) NULL, ADD COLUMN `fuel_type` VARCHAR(50) NULL;

INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('vehicle_type', 'รถเก๋ง', 1, NOW(), NOW()),
  ('vehicle_type', 'รถกระบะ', 2, NOW(), NOW()),
  ('vehicle_type', 'รถตู้', 3, NOW(), NOW()),
  ('vehicle_type', 'รถบรรทุก', 4, NOW(), NOW()),
  ('vehicle_fuel', 'น้ำมัน', 1, NOW(), NOW()),
  ('vehicle_fuel', 'ไฟฟ้า', 2, NOW(), NOW()),
  ('vehicle_fuel', 'ไฮบริด', 3, NOW(), NOW());

-- CreateTable
CREATE TABLE `vehicle_transfers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `vehicle_id` BIGINT NOT NULL,
    `from_branch_id` BIGINT NULL,
    `to_branch_id` BIGINT NULL,
    `note` TEXT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,

    INDEX `vehicle_transfers_vehicle_id_created_at_index`(`vehicle_id`, `created_at`),
    INDEX `vehicle_transfers_from_branch_id_index`(`from_branch_id`),
    INDEX `vehicle_transfers_to_branch_id_index`(`to_branch_id`),
    INDEX `vehicle_transfers_created_by_index`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateIndex
CREATE INDEX `vehicle_bookings_branch_id_index` ON `vehicle_bookings`(`branch_id`);

-- AddForeignKey
ALTER TABLE `vehicle_transfers` ADD CONSTRAINT `vehicle_transfers_vehicle_id_foreign` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `vehicle_transfers` ADD CONSTRAINT `vehicle_transfers_from_branch_id_foreign` FOREIGN KEY (`from_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `vehicle_transfers` ADD CONSTRAINT `vehicle_transfers_to_branch_id_foreign` FOREIGN KEY (`to_branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `vehicle_transfers` ADD CONSTRAINT `vehicle_transfers_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `vehicle_bookings` ADD CONSTRAINT `vehicle_bookings_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
