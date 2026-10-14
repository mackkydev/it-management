-- ปฏิทิน: ใบลา (อนุมัติโดยหัวหน้าที่ระบุ), ช่วงวันไปทำงานหน้างานจากใบแจ้งงาน, วันหยุดประจำปีของบริษัท
-- เพิ่มอย่างเดียว (additive) — ขอบเขตการมองเห็นปฏิทินต่อกลุ่มเก็บที่ app_settings.calendar_scope

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `leave_type` VARCHAR(20) NOT NULL,
    `unit` VARCHAR(10) NOT NULL DEFAULT 'full',
    `start_on` DATE NOT NULL,
    `end_on` DATE NOT NULL,
    `start_time` VARCHAR(5) NULL,
    `end_time` VARCHAR(5) NULL,
    `days` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `reason` TEXT NULL,
    `approver_id` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `decision_note` TEXT NULL,
    `cancelled_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    UNIQUE INDEX `leave_requests_uuid_unique`(`uuid`),
    INDEX `leave_requests_user_id_status_index`(`user_id`, `status`),
    INDEX `leave_requests_approver_id_status_index`(`approver_id`, `status`),
    INDEX `leave_requests_start_on_end_on_index`(`start_on`, `end_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `calendar_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(20) NOT NULL DEFAULT 'onsite',
    `user_id` BIGINT NOT NULL,
    `ticket_id` BIGINT NULL,
    `title` VARCHAR(255) NOT NULL,
    `start_on` DATE NOT NULL,
    `end_on` DATE NOT NULL,
    `note` TEXT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    UNIQUE INDEX `calendar_events_ticket_id_unique`(`ticket_id`),
    INDEX `calendar_events_user_id_index`(`user_id`),
    INDEX `calendar_events_start_on_end_on_index`(`start_on`, `end_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `company_holidays` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    UNIQUE INDEX `company_holidays_date_unique`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_approver_id_foreign` FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_ticket_id_foreign` FOREIGN KEY (`ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- กิจกรรมทั่วไป (type = event): แสดงทั้งบริษัทได้ (ผู้ดูแลระบบ)
ALTER TABLE `calendar_events` ADD COLUMN `all_company` BOOLEAN NOT NULL DEFAULT false;

-- โควตาวันลารายคน (ทับค่าตั้งต้นใน app_settings.leave_settings)
CREATE TABLE `leave_quota_overrides` (
    `user_id` BIGINT NOT NULL,
    `year` SMALLINT NOT NULL,
    `leave_type` VARCHAR(20) NOT NULL,
    `days` DECIMAL(5, 2) NOT NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(0) NULL,
    PRIMARY KEY (`user_id`, `year`, `leave_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- ไฟล์แนบใบลา (ใบรับรองแพทย์)
CREATE TABLE `leave_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `leave_id` BIGINT NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NULL,
    `size` INT NULL,
    `created_at` DATETIME(0) NULL,
    INDEX `leave_files_leave_id_index`(`leave_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- ลิงก์ iCal ส่วนตัว (ซิงก์กับ Outlook / Google Calendar)
ALTER TABLE `users` ADD COLUMN `calendar_token` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `users_calendar_token_unique` ON `users`(`calendar_token`);

ALTER TABLE `leave_quota_overrides` ADD CONSTRAINT `leave_quota_overrides_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `leave_files` ADD CONSTRAINT `leave_files_leave_id_foreign` FOREIGN KEY (`leave_id`) REFERENCES `leave_requests`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
