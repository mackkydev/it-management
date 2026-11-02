-- จอง ZOOM: ผู้ใช้จองช่วงวันเวลาใช้ ZOOM → ฝ่าย IT (zoom.manage) รับงาน → ส่งลิงก์ประชุม (confirmed + ใบแจ้งงานที่ปิดแล้วลง KPI ของผู้รับงาน)
-- หรือแจ้งกลับว่าช่วงเวลานั้นมีการใช้งานแล้ว (rejected) — เพิ่มอย่างเดียว (additive)

-- CreateTable
CREATE TABLE `zoom_bookings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `department` VARCHAR(255) NULL,
    `branch_id` BIGINT NULL,
    `title` VARCHAR(255) NOT NULL,
    `details` TEXT NULL,
    `start_on` DATE NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_on` DATE NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `assignee_id` BIGINT NULL,
    `accepted_at` DATETIME(0) NULL,
    `meeting_link` VARCHAR(1000) NULL,
    `link_note` TEXT NULL,
    `confirmed_by` BIGINT NULL,
    `confirmed_at` DATETIME(0) NULL,
    `reject_reason` VARCHAR(1000) NULL,
    `rejected_by` BIGINT NULL,
    `rejected_at` DATETIME(0) NULL,
    `cancelled_by` BIGINT NULL,
    `cancelled_at` DATETIME(0) NULL,
    `ticket_id` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `zoom_bookings_uuid_unique`(`uuid`),
    INDEX `zoom_bookings_start_on_end_on_index`(`start_on`, `end_on`),
    INDEX `zoom_bookings_user_id_index`(`user_id`),
    INDEX `zoom_bookings_status_index`(`status`),
    INDEX `zoom_bookings_ticket_id_index`(`ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `zoom_bookings` ADD CONSTRAINT `zoom_bookings_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `zoom_bookings` ADD CONSTRAINT `zoom_bookings_ticket_id_foreign` FOREIGN KEY (`ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
