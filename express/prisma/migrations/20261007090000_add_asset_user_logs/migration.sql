-- ประวัติผู้ใช้งานของสินทรัพย์ (ช่องข้อความ "ชื่อ-สกุลผู้ใช้งาน" / Department ของทะเบียนคอมพิวเตอร์)
-- แยกจาก asset_movements ที่เก็บสถานที่ + ผู้ถือครอง (บัญชีผู้ใช้ในระบบ)
CREATE TABLE `asset_user_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `from_user_name` VARCHAR(255) NULL,
    `to_user_name` VARCHAR(255) NULL,
    `from_department` VARCHAR(100) NULL,
    `to_department` VARCHAR(100) NULL,
    `source` VARCHAR(20) NOT NULL,
    `changed_at` DATETIME(0) NOT NULL,
    `performed_by` BIGINT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `asset_user_logs_asset_id_changed_at_index`(`asset_id`, `changed_at`),
    INDEX `asset_user_logs_performed_by_index`(`performed_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `asset_user_logs` ADD CONSTRAINT `asset_user_logs_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `asset_user_logs` ADD CONSTRAINT `asset_user_logs_performed_by_foreign` FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
