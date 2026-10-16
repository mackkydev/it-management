-- ยืมอุปกรณ์ IT (สินทรัพย์ที่เจ้าหน้าที่ IT ถือครอง) — routes/loans.ts

-- CreateTable
CREATE TABLE `equipment_loans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `asset_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `department` VARCHAR(255) NULL,
    `purpose` TEXT NOT NULL,
    `note` TEXT NULL,
    `start_on` DATE NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_on` DATE NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'reserved',
    `handed_out_at` DATETIME(0) NULL,
    `handed_out_by` BIGINT NULL,
    `returned_at` DATETIME(0) NULL,
    `returned_by` BIGINT NULL,
    `return_note` TEXT NULL,
    `overdue_notified_on` DATE NULL,
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `equipment_loans_uuid_unique`(`uuid`),
    INDEX `equipment_loans_asset_id_start_on_end_on_index`(`asset_id`, `start_on`, `end_on`),
    INDEX `equipment_loans_start_on_end_on_index`(`start_on`, `end_on`),
    INDEX `equipment_loans_user_id_index`(`user_id`),
    INDEX `equipment_loans_status_end_on_index`(`status`, `end_on`),
    INDEX `equipment_loans_handed_out_by_index`(`handed_out_by`),
    INDEX `equipment_loans_returned_by_index`(`returned_by`),
    INDEX `equipment_loans_cancelled_by_index`(`cancelled_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE `equipment_loans` ADD CONSTRAINT `equipment_loans_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `equipment_loans` ADD CONSTRAINT `equipment_loans_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `equipment_loans` ADD CONSTRAINT `equipment_loans_handed_out_by_foreign` FOREIGN KEY (`handed_out_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `equipment_loans` ADD CONSTRAINT `equipment_loans_returned_by_foreign` FOREIGN KEY (`returned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `equipment_loans` ADD CONSTRAINT `equipment_loans_cancelled_by_foreign` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

