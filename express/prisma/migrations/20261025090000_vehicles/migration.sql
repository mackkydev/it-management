-- ระบบจองรถ: รถ (+ รูป ≤ 4) / การจอง (หลายวันได้, ไม่ระบุรถได้ — ผู้จัดคิวรถเลือกให้) / รายการเพิ่มเติม / เลขไมล์ — เพิ่มอย่างเดียว (additive)
-- ประเภทการใช้งาน / รายการเพิ่มเติม = ข้อมูล Drop Down (dropdown_options list vehicle_purpose / vehicle_extra)

-- CreateTable
CREATE TABLE `vehicles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `plate_no` VARCHAR(30) NULL,
    `branch_id` BIGINT NULL,
    `seats` SMALLINT NOT NULL,
    `parking` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `mileage` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `vehicles_name_unique`(`name`),
    UNIQUE INDEX `vehicles_plate_no_unique`(`plate_no`),
    INDEX `vehicles_branch_id_index`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `vehicle_images` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `vehicle_id` BIGINT NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `size` INTEGER NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,

    INDEX `vehicle_images_vehicle_id_index`(`vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `vehicle_bookings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `vehicle_id` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `department` VARCHAR(255) NULL,
    `details` TEXT NOT NULL,
    `passengers` SMALLINT NOT NULL,
    `purpose` VARCHAR(100) NULL,
    `note` TEXT NULL,
    `start_on` DATE NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_on` DATE NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `start_mileage` INTEGER NULL,
    `end_mileage` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    `assigned_by` BIGINT NULL,
    `assigned_at` DATETIME(0) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `vehicle_bookings_uuid_unique`(`uuid`),
    INDEX `vehicle_bookings_vehicle_id_start_on_end_on_index`(`vehicle_id`, `start_on`, `end_on`),
    INDEX `vehicle_bookings_start_on_end_on_index`(`start_on`, `end_on`),
    INDEX `vehicle_bookings_user_id_index`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `vehicle_booking_extras` (
    `booking_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`booking_id`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vehicle_images` ADD CONSTRAINT `vehicle_images_vehicle_id_foreign` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vehicle_bookings` ADD CONSTRAINT `vehicle_bookings_vehicle_id_foreign` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vehicle_bookings` ADD CONSTRAINT `vehicle_bookings_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `vehicle_booking_extras` ADD CONSTRAINT `vehicle_booking_extras_booking_id_foreign` FOREIGN KEY (`booking_id`) REFERENCES `vehicle_bookings`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;


-- ค่าตั้งต้น (ผู้ดูแลเพิ่ม/แก้ได้ที่ ข้อมูล Drop Down)
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('vehicle_purpose', 'ใช้งานวันเดียว', 1, NOW(), NOW()),
  ('vehicle_purpose', 'ออกต่างจังหวัดหลายวัน', 2, NOW(), NOW()),
  ('vehicle_extra', 'น้ำมันเต็มถัง', 1, NOW(), NOW()),
  ('vehicle_extra', 'บัตรเติมน้ำมัน/ไฟฟ้า', 2, NOW(), NOW()),
  ('vehicle_extra', 'Easy Pass', 3, NOW(), NOW());
