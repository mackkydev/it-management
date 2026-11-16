-- สัญญา vendor: แนบเอกสารได้หลายไฟล์ (ไฟล์ละ ≤ 5MB) + วันที่แจ้งเตือนที่กำหนดเองต่อสัญญา (นอกจากจำนวนวันก่อนหมดอายุ)
ALTER TABLE `contracts` ADD COLUMN `notify_dates` JSON NULL;
ALTER TABLE `contracts` ADD COLUMN `notified_for_date` DATE NULL;

CREATE TABLE `contract_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `contract_id` BIGINT NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `contract_files_contract_id_index`(`contract_id`),
    INDEX `contract_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `contract_files` ADD CONSTRAINT `contract_files_contract_id_foreign` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `contract_files` ADD CONSTRAINT `contract_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
