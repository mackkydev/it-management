-- Vendor: ลิงก์ตำแหน่งจาก Google Maps + ไฟล์เอกสารบริษัท / รายการส่งซ่อม: S/N ที่กรอกเองเมื่อสินทรัพย์ไม่มี S/N
ALTER TABLE `vendors` ADD COLUMN `map_url` VARCHAR(1000) NULL;
ALTER TABLE `repair_orders` ADD COLUMN `item_serial` VARCHAR(100) NULL;

CREATE TABLE `vendor_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `vendor_id` BIGINT NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `vendor_files_vendor_id_index`(`vendor_id`),
    INDEX `vendor_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `vendor_files` ADD CONSTRAINT `vendor_files_vendor_id_foreign` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `vendor_files` ADD CONSTRAINT `vendor_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
