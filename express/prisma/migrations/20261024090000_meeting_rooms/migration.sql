-- ระบบจองห้องประชุม: ห้อง (+ รูป ≤ 4) / การจอง (วันเดียว + ช่วงเวลา) / อุปกรณ์ที่ขอใช้ — เพิ่มอย่างเดียว (additive)
-- ประเภทการใช้งาน / อุปกรณ์ = ข้อมูล Drop Down (dropdown_options list meeting_purpose / meeting_equipment)

-- CreateTable
CREATE TABLE `meeting_rooms` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `branch_id` BIGINT NULL,
    `location` VARCHAR(255) NULL,
    `room_no` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `seats` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `meeting_rooms_name_unique`(`name`),
    INDEX `meeting_rooms_branch_id_index`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `meeting_room_images` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `room_id` BIGINT NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `size` INTEGER NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,

    INDEX `meeting_room_images_room_id_index`(`room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `meeting_bookings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `room_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `department` VARCHAR(255) NULL,
    `title` VARCHAR(255) NOT NULL,
    `attendees` SMALLINT NOT NULL,
    `purpose` VARCHAR(100) NULL,
    `note` TEXT NULL,
    `booking_date` DATE NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `meeting_bookings_uuid_unique`(`uuid`),
    INDEX `meeting_bookings_room_id_booking_date_index`(`room_id`, `booking_date`),
    INDEX `meeting_bookings_booking_date_index`(`booking_date`),
    INDEX `meeting_bookings_user_id_index`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `meeting_booking_equipment` (
    `booking_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`booking_id`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `meeting_rooms` ADD CONSTRAINT `meeting_rooms_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `meeting_room_images` ADD CONSTRAINT `meeting_room_images_room_id_foreign` FOREIGN KEY (`room_id`) REFERENCES `meeting_rooms`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `meeting_bookings` ADD CONSTRAINT `meeting_bookings_room_id_foreign` FOREIGN KEY (`room_id`) REFERENCES `meeting_rooms`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `meeting_bookings` ADD CONSTRAINT `meeting_bookings_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `meeting_booking_equipment` ADD CONSTRAINT `meeting_booking_equipment_booking_id_foreign` FOREIGN KEY (`booking_id`) REFERENCES `meeting_bookings`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;


-- ค่าตั้งต้น (ผู้ดูแลเพิ่ม/แก้ได้ที่ ข้อมูล Drop Down)
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('meeting_purpose', 'ประชุม', 1, NOW(), NOW()),
  ('meeting_purpose', 'สัมมนา', 2, NOW(), NOW()),
  ('meeting_purpose', 'อบรม', 3, NOW(), NOW()),
  ('meeting_purpose', 'จัดเลี้ยง', 4, NOW(), NOW()),
  ('meeting_equipment', 'จอ + โปรเจคเตอร์', 1, NOW(), NOW()),
  ('meeting_equipment', 'โน้ตบุ๊ค', 2, NOW(), NOW()),
  ('meeting_equipment', 'ชุด Conference', 3, NOW(), NOW()),
  ('meeting_equipment', 'Zoom Meeting', 4, NOW(), NOW());
